import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { newId } from "../lib/id";

export type Contact = {
  id: string;
  email: string;
  displayName: string;
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

export const useContactsStore = create<ContactsStore>()(
  persist(
    (set) => ({
      contacts: [],

      addContact: (email, displayName) => {
        const id = newId();
        set((s) => ({
          contacts: [...s.contacts, { id, email: email.trim(), displayName: displayName.trim() }],
        }));
        return id;
      },

      updateContact: (id, patch) => {
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        }));
      },

      removeContact: (id) => {
        set((s) => ({
          contacts: s.contacts.filter((c) => c.id !== id),
        }));
      },
    }),
    {
      name: "quicknote.contactsStore.v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

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
