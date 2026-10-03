// QFM(QuickNote-flavored Markdown) 문법 요약 — MCP 도구 설명에 그대로 사용한다.
export const QFM_SYNTAX_GUIDE = `QuickNote-flavored Markdown (QFM) / QuickNote 마크다운 규약
- Standard CommonMark/GFM: # ~ ###### headings, paragraphs, **bold**, _italic_ (or *italic*), ~~strike~~, \`code\`, [text](url), - / 1. / nested lists (indent children), - [ ] / - [x] tasks, \`\`\`lang fenced code, > blockquote, --- divider, GFM | tables |, ![alt](url "title") image on its own line.
- Line break / 줄바꿈: a single newline inside a paragraph is a hard line break. Separate blocks with a blank line. Empty paragraph / 빈 줄 블록: <empty-block/>
- Escape literal markdown characters with a backslash: \\* \\_ \\[ \\< \\#
- Inline styles / 인라인 서식: <u>underline</u>, <span color="red">text color</span>, <mark>highlight</mark>, <mark color="yellow">colored highlight</mark>
  Colors must be #hex (3/6/8 digits), rgb()/rgba(), or a plain color name/token (red, darkGray); anything else is ignored.
- Callout / 콜아웃 (body is markdown blocks):
  <callout preset="info" icon="💡">
  body
  </callout>
  preset: idea(default) | info | warning | danger | success | note | tip | none | empty, or *-plain variants. icon optional. Also accepted on input: > [!NOTE] / [!TIP] / [!WARNING] / [!CAUTION] / [!IMPORTANT]
- Toggle / 토글 (add "open" to show expanded):
  <details open><summary>title</summary>

  body

  </details>
- Columns / 다단 (2~6 columns, optional width ratio):
  <columns>
  <column>left blocks</column>
  <column width="2">right blocks</column>
  </columns>
- Page mention / 페이지 멘션: <mention-page id="PAGE_ID">title</mention-page>
- Member mention / 멤버 멘션: <mention-user id="MEMBER_ID">name</mention-user>
- Database mention: <mention-database id="DB_ID">name</mention-database>; page link button: <page-link id="PAGE_ID">label</page-link>
- Inline date / 날짜: <date value="2026-01-31"/> (YYYY-MM-DD required; missing value → dropped, malformed value → plain text); inline icon: <icon name="Star" color="#f59e0b"/>; button: <button label="Open" href="https://…"/>
- Database block / 데이터베이스: <database id="DB_ID" layout="inline|fullPage" view="table|board|…"/> (view settings are kept when the id matches an existing block)
- Embeds / 임베드 (one per line): <bookmark href="https://…"/>, <youtube src="https://youtu.be/…"/>, <file src="…" name="a.pdf"/>, <image src="…" width="320" align="center" caption="…"/>
- Opaque blocks / 보존 블록: <qn-block id="BLOCK_ID" type="flowchartBlock"/> stands for content that cannot be expressed in markdown (tabs, flowcharts, galleries, dropdown menus, merged-cell tables).
  qn-block 줄: 지우면 블록 삭제, 다른 위치로 이동 가능, 복제 불가(같은 id 두 번 → DUPLICATE_BLOCK_REF 오류). Delete the line to delete the block; move it to reorder; never duplicate it or invent ids (unknown id → UNRESOLVED_BLOCK_REF error). A <qn-block type="X"/> without id is a read-only placeholder and is dropped on write.
- Limits / 제한: input up to 512KB (larger → INPUT_TOO_LARGE). javascript:/vbscript:/data: URLs are removed from links and src/href attributes.
- Not preserved on write / 저장 시 손실: block background/text color, text alignment, indentation, table column widths and header-less tables, multiple paragraphs inside one table cell (merged with line breaks).`;
