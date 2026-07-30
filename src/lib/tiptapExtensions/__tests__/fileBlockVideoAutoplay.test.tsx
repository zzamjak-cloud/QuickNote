import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FileBlock } from "../fileBlock";

function FileBlockVideoEditor() {
  const editor = useEditor({
    extensions: [StarterKit, FileBlock],
    content: {
      type: "doc",
      content: [
        {
          type: "fileBlock",
          attrs: {
            src: "https://example.com/sample.mp4",
            name: "sample.mp4",
            mime: "video/mp4",
          },
        },
      ],
    },
    immediatelyRender: false,
  });

  return <EditorContent editor={editor} />;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FileBlock 비디오 자동재생", () => {
  it("본문 비디오는 음소거 상태로 자동재생하며 끝나면 반복한다", async () => {
    const { container } = render(<FileBlockVideoEditor />);

    await waitFor(() => {
      expect(container.querySelector("video")).toBeTruthy();
    });

    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", "https://example.com/sample.mp4");
    expect(video.autoplay).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.preload).toBe("auto");
    expect(video.hasAttribute("playsinline")).toBe(true);
  });
});
