// CSV 임직원 데이터 파싱 헬퍼
// Email(ID@) 컬럼 값에 @loadcomplete.com 도메인 자동 추가
// 상태 컬럼: "휴직중" → "휴직" 정규화

import type { EmploymentStatus, Member } from "../../store/memberStore";
import type { Organization } from "../../store/organizationStore";
import type { Team } from "../../store/teamStore";

/** CSV 한 행의 파싱 결과 */
export type CsvMemberRow = {
  name: string;
  employeeNumber: string;
  email: string;
  department: string;
  team: string;
  jobTitle: string;
  jobCategory: string;
  jobDetail: string;
  joinedAt: string;
  employmentStatus: EmploymentStatus;
};

/** CSV 텍스트 → 행 배열 파싱 */
function parseCsvText(text: string): CsvMemberRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  if (!header) return [];
  const cols = splitCsvLine(header);

  // 헤더 인덱스 맵
  const idx = (name: string) => cols.indexOf(name);
  const iNo = idx("No");
  const iStatus = idx("상태");
  const iName = idx("성명");
  const iEmpNo = idx("사번");
  const iEmail = idx("Email(ID@)");
  const iDept = idx("소속(실)");
  const iTeam = idx("소속(팀)");
  const iTitle = idx("직책");
  const iCat = idx("직무");
  const iDetail = idx("상세직무");
  const iJoined = idx("입사일");

  const rows: CsvMemberRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = splitCsvLine(line);
    const get = (j: number) => (j >= 0 ? (cells[j] ?? "").trim() : "");

    const rawName = get(iName);
    if (!rawName) continue;

    // 행 번호는 저장 안 함 (iNo 사용 안 함)
    void iNo;

    // Email: "junction@" → "junction@loadcomplete.com"
    const rawEmail = get(iEmail);
    const email = normalizeEmail(rawEmail);

    // 상태: "휴직중" → "휴직"
    const rawStatus = get(iStatus);
    const employmentStatus = normalizeStatus(rawStatus);

    rows.push({
      name: rawName,
      employeeNumber: get(iEmpNo),
      email,
      department: get(iDept),
      team: get(iTeam),
      jobTitle: get(iTitle) === "-" ? "" : get(iTitle),
      jobCategory: get(iCat),
      jobDetail: get(iDetail),
      joinedAt: get(iJoined),
      employmentStatus,
    });
  }

  return rows;
}

/** CSV 한 줄을 셀 배열로 분리 (따옴표 처리 포함) */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/** Email(ID@) 값에 loadcomplete.com 도메인 추가 */
function normalizeEmail(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  // "junction@" 형태: @ 로 끝나면 도메인 추가
  if (v.endsWith("@")) return v + "loadcomplete.com";
  // 이미 완전한 이메일이면 그대로
  if (v.includes("@") && !v.endsWith("@")) return v;
  // "@" 가 없으면 아이디로 간주해 도메인 추가
  return v + "@loadcomplete.com";
}

/** 상태 정규화 */
function normalizeStatus(raw: string): EmploymentStatus {
  if (raw === "휴직중") return "휴직";
  if (raw === "병가") return "병가";
  if (raw === "퇴사") return "퇴사";
  return "재직중";
}

/** 퇴사 인원은 조직·팀·직책·직무·상세직무 unique 집계에서 제외한다. */
function activeRows(rows: CsvMemberRow[]): CsvMemberRow[] {
  return rows.filter((r) => r.employmentStatus !== "퇴사");
}

/** CSV 파싱 결과에서 unique 소속(실) 목록 추출 (퇴사 제외) */
export function extractDepartments(rows: CsvMemberRow[]): string[] {
  return [...new Set(activeRows(rows).map((r) => r.department).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

/** CSV 파싱 결과에서 unique 소속(팀) 목록 추출 (퇴사 제외) */
export function extractTeams(rows: CsvMemberRow[]): string[] {
  return [...new Set(activeRows(rows).map((r) => r.team).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

/** CSV 파싱 결과에서 unique 직책 목록 추출 (퇴사 제외) */
export function extractJobTitles(rows: CsvMemberRow[]): string[] {
  return [...new Set(activeRows(rows).map((r) => r.jobTitle).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

/** CSV 파싱 결과에서 unique 직무 목록 추출 (퇴사 제외) */
export function extractJobCategories(rows: CsvMemberRow[]): string[] {
  return [...new Set(activeRows(rows).map((r) => r.jobCategory).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

/** CSV 파싱 결과에서 unique 상세직무 목록 추출 (퇴사 제외) */
export function extractJobDetails(rows: CsvMemberRow[]): string[] {
  return [...new Set(activeRows(rows).map((r) => r.jobDetail).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

/** CSV 행 → Organization 배열 생성 (name 기반 ID 생성) */
export function buildOrganizationsFromRows(rows: CsvMemberRow[]): Organization[] {
  const names = extractDepartments(rows);
  return names.map((name) => ({
    organizationId: "org-" + slugify(name),
    name,
    leaderMemberIds: [],
    members: [],
    createdAt: new Date().toISOString(),
  }));
}

/** CSV 행 → Team 배열 생성 (name 기반 ID 생성) */
export function buildTeamsFromRows(rows: CsvMemberRow[]): Team[] {
  const names = extractTeams(rows);
  return names.map((name) => ({
    teamId: "team-" + slugify(name),
    name,
    leaderMemberIds: [],
    members: [],
    createdAt: new Date().toISOString(),
  }));
}

/** 기존 멤버 배열과 CSV 행을 병합해 upsert 결과 반환
 *  - 기존 멤버: 이름 또는 이메일 매칭 → 새 필드만 덮어씀 (workspaceRole 유지)
 *  - 신규 멤버: workspaceRole = "member", status = "active"
 */
export function mergeMembersFromCsv(
  existingMembers: Member[],
  rows: CsvMemberRow[],
  generateId: () => string,
): { updated: Member[]; created: Member[] } {
  const updated: Member[] = [];
  const created: Member[] = [];

  for (const row of rows) {
    // 이름 또는 이메일로 매칭
    const existing = existingMembers.find(
      (m) =>
        m.name === row.name ||
        (row.email && m.email.toLowerCase() === row.email.toLowerCase()),
    );

    const csvFields: Partial<Member> = {
      employmentStatus: row.employmentStatus,
      employeeNumber: row.employeeNumber || undefined,
      department: row.department || undefined,
      team: row.team || undefined,
      jobTitle: row.jobTitle || undefined,
      jobCategory: row.jobCategory || undefined,
      jobDetail: row.jobDetail || undefined,
      joinedAt: row.joinedAt || undefined,
      email: row.email || (existing?.email ?? ""),
    };

    if (existing) {
      updated.push({ ...existing, ...csvFields });
    } else {
      // 퇴사 인원은 신규 생성하지 않는다 — 기존 등록 멤버만 상태 갱신.
      if (row.employmentStatus === "퇴사") continue;
      created.push({
        memberId: generateId(),
        email: row.email,
        name: row.name,
        jobRole: row.jobCategory || "",
        workspaceRole: "member",
        status: "active",
        personalWorkspaceId: "",
        ...csvFields,
      });
    }
  }

  return { updated, created };
}

/** 한글/영문 문자열 → URL-safe slug */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w가-힣-]/g, "")
    .slice(0, 40);
}

export { parseCsvText };
