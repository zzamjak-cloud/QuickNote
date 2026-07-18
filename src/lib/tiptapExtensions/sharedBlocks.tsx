import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  DropdownMenuBlockView,
  GalleryBlockView,
} from "../../components/sharedBlocks/SharedBlockView";
import { newId } from "../id";
import {
  SHARED_BLOCK_SCHEMA_VERSION,
  emptyDropdownMenu,
  emptyGallery,
  serializeSharedBlockData,
} from "../../types/sharedBlock";

export type SharedBlockAttrs = {
  sharedBlockId: string;
  data: string | Record<string, unknown>;
  version: number;
  /** 공개 변환 doc 에서만 true. 로컬 저장소·인증 API를 사용하지 않는다. */
  publicMode: boolean;
  /** 새 갤러리 삽입 직후 편집 팝업을 한 번 자동으로 연다. */
  autoOpenEditor: boolean;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dropdownMenuBlock: {
      insertDropdownMenuBlock: () => ReturnType;
    };
    galleryBlock: {
      insertGalleryBlock: () => ReturnType;
    };
  }
}

export const DropdownMenuBlock = Node.create({
  name: "dropdownMenuBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      sharedBlockId: { default: "" },
      data: { default: serializeSharedBlockData(emptyDropdownMenu()) },
      version: { default: SHARED_BLOCK_SCHEMA_VERSION },
      publicMode: { default: false },
      autoOpenEditor: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-dropdown-menu-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-dropdown-menu-block": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DropdownMenuBlockView) as unknown as NodeViewRenderer;
  },

  addCommands() {
    return {
      insertDropdownMenuBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              sharedBlockId: newId(),
              data: serializeSharedBlockData(emptyDropdownMenu()),
              version: SHARED_BLOCK_SCHEMA_VERSION,
            },
          }),
    };
  },
});

export const GalleryBlock = Node.create({
  name: "galleryBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      sharedBlockId: { default: "" },
      data: { default: serializeSharedBlockData(emptyGallery()) },
      version: { default: SHARED_BLOCK_SCHEMA_VERSION },
      publicMode: { default: false },
      autoOpenEditor: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-gallery-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-gallery-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GalleryBlockView) as unknown as NodeViewRenderer;
  },

  addCommands() {
    return {
      insertGalleryBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              sharedBlockId: newId(),
              data: serializeSharedBlockData(emptyGallery()),
              version: SHARED_BLOCK_SCHEMA_VERSION,
              autoOpenEditor: true,
            },
          }),
    };
  },
});
