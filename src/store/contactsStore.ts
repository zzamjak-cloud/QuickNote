import { create } from "zustand";
import { newId } from "../lib/id";
import { enqueueAsync } from "../lib/sync/runtime";
import { useAuthStore } from "./authStore";

export type Contact = {
  id: string;
  email: string;
  displayName: string;
  /** epoch ms — GraphQL 경계에서 ISO 문자열로 변환 */
  createdAt: number;
  /** epoch ms — GraphQL 경계에서 ISO 문자열로 변환 */
  updatedAt: number;
};

type State = {
  contacts: Contact[];
};

type Actions = {
  addContact: (email: string, displayName: string) => string;
  updateContact: (id: string, patch: Partial<Pick<Contact, "email" | "displayName">>) => void;
  removeContact: (id: string) => void;
};

export type ContactsStore = State & Actions;

function getOwnerId(): string {
  const s = useAuthStore.getState().state;
  return s.status === "authenticated" ? s.user.sub : "";
}

function toGqlContact(c: Contact, ownerId: string): Record<string, unknown> {
  return {
    id: c.id,
    ownerId,
    email: c.email,
    displayName: c.displayName,
    createdAt: new Date(c.createdAt).toISOString(),
    updatedAt: new Date(c.updatedAt).toISOString(),
  };
}

function enqueueUpsertContact(c: Contact): void {
  enqueueAsync(
    "upsertContact",
    toGqlContact(c, getOwnerId()) as Record<string, unknown> & {
      id: string;
      updatedAt?: string;
    },
  );
}

export const useContactsStore = create<ContactsStore>()((set) => ({
  contacts: [],

  addContact: (email, displayName) => {
    const id = newId();
    const now = Date.now();
    const contact: Contact = {
      id,
      email: email.trim(),
      displayName: displayName.trim(),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ contacts: [...s.contacts, contact] }));
    enqueueUpsertContact(contact);
    return id;
  },

  updateContact: (id, patch) => {
    let after: Contact | undefined;
    set((s) => {
      const next = s.contacts.map((c) => {
        if (c.id !== id) return c;
        const merged = { ...c, ...patch, updatedAt: Date.now() };
        after = merged;
        return merged;
      });
      return { contacts: next };
    });
    if (after) enqueueUpsertContact(after);
  },

  removeContact: (id) => {
    set((s) => ({
      contacts: s.contacts.filter((c) => c.id !== id),
    }));
    enqueueAsync("softDeleteContact", {
      id,
      updatedAt: new Date().toISOString(),
    });
  },
}));

export function searchContacts(
  contacts: Contact[],
  query: string,
): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter(
    (c) =>
      c.email.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q),
  );
}
