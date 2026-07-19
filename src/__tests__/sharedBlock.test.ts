import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GALLERY_INTERVAL_MS,
  emptyDropdownMenu,
  normalizeSharedBlockAlign,
  parseDropdownMenuData,
  parseGalleryData,
  serializeSharedBlockData,
  type SharedBlockRecord,
} from "../types/sharedBlock";
import {
  sharedBlockRecordKey,
  useSharedBlockStore,
} from "../store/sharedBlockStore";

describe("공유 블록 데이터", () => {
  it("정렬 값은 좌측을 기본으로 하고 지원하는 값만 유지한다", () => {
    expect(normalizeSharedBlockAlign(undefined)).toBe("left");
    expect(normalizeSharedBlockAlign("center")).toBe("center");
    expect(normalizeSharedBlockAlign("right")).toBe("right");
    expect(normalizeSharedBlockAlign("justify")).toBe("left");
  });

  it("드롭다운 메뉴를 직렬화하고 복원한다", () => {
    const data = {
      kind: "dropdown-menu" as const,
      items: [
        {
          id: "ko",
          label: "한국어",
          pageId: "page-ko",
          pageLabel: "제품 소개 (kr)",
        },
      ],
    };
    expect(parseDropdownMenuData(serializeSharedBlockData(data))).toEqual(data);
  });

  it("AppSync AWSJSON 이중 인코딩에서도 드롭다운과 갤러리를 복원한다", () => {
    const dropdown = {
      kind: "dropdown-menu" as const,
      items: [{ id: "ko", label: "한국어", pageId: "page-ko" }],
    };
    const gallery = {
      kind: "gallery" as const,
      images: [
        {
          id: "banner-1",
          src: "quicknote-image://asset-banner-1",
          alt: "배너 1",
        },
      ],
      intervalMs: 5_000,
    };

    expect(
      parseDropdownMenuData(JSON.stringify(serializeSharedBlockData(dropdown))),
    ).toEqual(dropdown);
    expect(
      parseGalleryData(JSON.stringify(serializeSharedBlockData(gallery))),
    ).toEqual(gallery);
  });

  it("깨진 드롭다운 데이터는 안전한 빈 메뉴로 복원한다", () => {
    expect(parseDropdownMenuData("{broken")).toEqual(emptyDropdownMenu());
  });

  it("갤러리의 깨진 항목을 버리고 전환 간격을 허용 범위로 보정한다", () => {
    const parsed = parseGalleryData({
      images: [
        { id: "a", src: "quicknote-image://asset-a", alt: "A" },
        { id: "broken", src: "" },
      ],
      intervalMs: 999_999,
    });
    expect(parsed.images).toHaveLength(1);
    expect(parsed.intervalMs).toBe(15_000);
    expect(parseGalleryData(null).intervalMs).toBe(DEFAULT_GALLERY_INTERVAL_MS);
  });
});

describe("공유 블록 LWW 저장소", () => {
  beforeEach(() => {
    useSharedBlockStore.setState({ records: {} });
  });

  it("같은 id의 최신 원격 레코드만 반영한다", () => {
    const base: SharedBlockRecord = {
      id: "shared-1",
      workspaceId: "workspace-1",
      kind: "dropdown-menu",
      data: emptyDropdownMenu(),
      updatedAt: 100,
      deletedAt: null,
    };
    useSharedBlockStore.getState().applyRemote(base);
    useSharedBlockStore.getState().applyRemote({
      ...base,
      updatedAt: 99,
      data: {
        kind: "dropdown-menu",
        items: [{ id: "old", label: "과거", pageId: "old" }],
      },
    });
    const key = sharedBlockRecordKey(base.workspaceId, base.id);
    expect(useSharedBlockStore.getState().records[key]?.data).toEqual(emptyDropdownMenu());

    useSharedBlockStore.getState().applyRemote({
      ...base,
      updatedAt: 101,
      data: {
        kind: "dropdown-menu",
        items: [{ id: "new", label: "최신", pageId: "new" }],
      },
    });
    expect(useSharedBlockStore.getState().records[key]?.updatedAt).toBe(101);
  });

  it("같은 timestamp 충돌은 서버가 반환한 승자 data로 수렴한다", () => {
    const record: SharedBlockRecord = {
      id: "collision",
      workspaceId: "workspace-1",
      kind: "dropdown-menu",
      data: {
        kind: "dropdown-menu",
        items: [{ id: "local", label: "로컬", pageId: "page-local" }],
      },
      updatedAt: 100,
      deletedAt: null,
    };
    useSharedBlockStore.getState().applyRemote(record);
    const applied = useSharedBlockStore.getState().applyRemote({
      ...record,
      data: {
        kind: "dropdown-menu",
        items: [{ id: "server", label: "서버", pageId: "page-server" }],
      },
    });

    expect(applied).toBe(true);
    expect(useSharedBlockStore.getState().records[
      sharedBlockRecordKey(record.workspaceId, record.id)
    ]?.data).toMatchObject({ items: [{ label: "서버" }] });
  });

  it("인라인 시드는 서버 최신본이 항상 덮어쓸 수 있게 시각 0을 사용한다", () => {
    useSharedBlockStore.getState().seedIfAbsent({
      id: "seeded",
      workspaceId: "workspace-1",
      kind: "gallery",
      data: { kind: "gallery", images: [], intervalMs: 5_000 },
    });
    const key = sharedBlockRecordKey("workspace-1", "seeded");
    expect(useSharedBlockStore.getState().records[key]?.updatedAt).toBe(0);
    useSharedBlockStore.getState().applyRemote({
      id: "seeded",
      workspaceId: "workspace-1",
      kind: "gallery",
      data: {
        kind: "gallery",
        images: [{ id: "server", src: "quicknote-image://server", alt: "" }],
        intervalMs: 5_000,
      },
      updatedAt: 1,
      deletedAt: null,
    });
    const data = useSharedBlockStore.getState().records[key]?.data;
    expect(data?.kind === "gallery" ? data.images[0]?.id : null).toBe("server");
  });

  it("같은 id라도 workspace별 레코드를 서로 다른 슬롯에 격리한다", () => {
    const base: SharedBlockRecord = {
      id: "same-id",
      workspaceId: "workspace-a",
      kind: "dropdown-menu",
      data: {
        kind: "dropdown-menu",
        items: [{ id: "a", label: "A", pageId: "page-a" }],
      },
      updatedAt: 999,
      deletedAt: null,
    };
    useSharedBlockStore.getState().applyRemote(base);
    useSharedBlockStore.getState().applyRemote({
      ...base,
      workspaceId: "workspace-b",
      updatedAt: 1,
      data: {
        kind: "dropdown-menu",
        items: [{ id: "b", label: "B", pageId: "page-b" }],
      },
    });

    const records = useSharedBlockStore.getState().records;
    expect(records[sharedBlockRecordKey("workspace-a", base.id)]?.data).toMatchObject({
      items: [{ label: "A" }],
    });
    expect(records[sharedBlockRecordKey("workspace-b", base.id)]?.data).toMatchObject({
      items: [{ label: "B" }],
    });
  });
});
