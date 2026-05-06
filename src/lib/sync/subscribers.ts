import { appsyncClient } from "./graphql/client";
import {
  ON_PAGE_CHANGED,
  ON_DATABASE_CHANGED,
  ON_CONTACT_CHANGED,
  type GqlPage,
  type GqlDatabase,
  type GqlContact,
} from "./graphql/operations";

// 자기 ownerId 의 변경 푸시를 수신해 LWW 적용 콜백을 호출.
// 반환된 함수를 호출하면 모든 구독을 unsubscribe.

export type SubscribeHandlers = {
  onPage: (item: GqlPage) => void;
  onDatabase: (item: GqlDatabase) => void;
  onContact: (item: GqlContact) => void;
};

type Subscribable = {
  subscribe: (h: {
    next: (msg: { data: Record<string, unknown> }) => void;
    error: (e: unknown) => void;
  }) => { unsubscribe: () => void };
};

export function startSubscriptions(
  ownerId: string,
  handlers: SubscribeHandlers,
): () => void {
  const c = appsyncClient();

  const pageObs = c.graphql({
    query: ON_PAGE_CHANGED,
    variables: { ownerId },
  }) as unknown as Subscribable;
  const pageSub = pageObs.subscribe({
    next: ({ data }) => handlers.onPage(data.onPageChanged as GqlPage),
    error: (e) => console.error("[sub:page]", e),
  });

  const dbObs = c.graphql({
    query: ON_DATABASE_CHANGED,
    variables: { ownerId },
  }) as unknown as Subscribable;
  const dbSub = dbObs.subscribe({
    next: ({ data }) =>
      handlers.onDatabase(data.onDatabaseChanged as GqlDatabase),
    error: (e) => console.error("[sub:database]", e),
  });

  const contactObs = c.graphql({
    query: ON_CONTACT_CHANGED,
    variables: { ownerId },
  }) as unknown as Subscribable;
  const contactSub = contactObs.subscribe({
    next: ({ data }) =>
      handlers.onContact(data.onContactChanged as GqlContact),
    error: (e) => console.error("[sub:contact]", e),
  });

  return () => {
    pageSub.unsubscribe();
    dbSub.unsubscribe();
    contactSub.unsubscribe();
  };
}
