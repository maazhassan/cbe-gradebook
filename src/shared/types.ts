import type { Score, ScoreRecord } from './grading'

export interface Subject {
  id: number
  name: string
}

export interface Stem {
  id: number
  subjectId: number
  name: string
  displayOrder: number
  active: boolean
}

export interface Course {
  id: number
  name: string
  subjectId: number
  subjectName: string
  archived: boolean
  activeStudentCount: number
}

export interface StudentListItem {
  id: number
  firstName: string
  lastName: string
  archived: boolean
  activeCourseIds: number[]
}

export interface Enrollment {
  courseId: number
  courseName: string
  subjectName: string
  courseArchived: boolean
  active: boolean
}

export interface Student {
  id: number
  firstName: string
  lastName: string
  archived: boolean
  positiveComment1: string
  positiveComment2: string
  growthComment: string
  enrollments: Enrollment[]
}

export interface Comments {
  positiveComment1: string
  positiveComment2: string
  growthComment: string
}

export interface GradebookAssignment {
  id: number
  name: string
  maxPoints: number
  weight: number
  /** ISO calendar date, YYYY-MM-DD. */
  dueDate: string
  sortOrder: number
  stemIds: number[]
}

export interface RosterStudent {
  id: number
  firstName: string
  lastName: string
}

export interface CourseGradebook {
  course: Course
  assignments: GradebookAssignment[]
  /** Active enrolments only, sorted by last then first name. */
  students: RosterStudent[]
  scores: ScoreRecord[]
  /** Active stems for the subject, plus inactive stems still linked to an assignment in this course. */
  stems: Stem[]
}

export interface DashboardCourse {
  course: Course
  enrollmentActive: boolean
  assignments: GradebookAssignment[]
  /** Only this student's scores. */
  scores: ScoreRecord[]
  stems: Stem[]
}

export interface StudentDashboard {
  student: Student
  courses: DashboardCourse[]
}

export interface LogEntry {
  id: number
  studentId: number
  studentFirstName: string
  studentLastName: string
  title: string
  body: string
  archived: boolean
  /** ISO timestamp. */
  createdAt: string
}

export interface AppInfo {
  version: string
  schemaVersion: number
  databasePath: string
  backupDirectory: string
  autoBackups: { name: string; modified: string }[]
}

export interface AssignmentInput {
  name: string
  maxPoints: number
  weight: number
  dueDate: string
  stemIds: number[]
}

export type RosterAction =
  | { action: 'create'; firstName: string; lastName: string }
  | { action: 'existing'; studentId: number }

export interface RosterImportResult {
  created: number
  matchedExisting: number
  enrolments: number
}

export interface MacroArmed {
  accelerator: string
  /** Epoch milliseconds. */
  expiresAt: number
  count: number
}

export type MacroEvent =
  | { kind: 'done'; label: string; count: number }
  | { kind: 'expired'; label: string }
  | { kind: 'error'; label: string; message: string }

export type FileResult = { saved: true; path: string } | { saved: false }
export type RestoreResult = { restored: true; path: string } | { restored: false }
export type PickedFile = { name: string; text: string } | null

export interface Api {
  getAppInfo(): Promise<AppInfo>

  listSubjects(): Promise<Subject[]>
  listStems(): Promise<Stem[]>
  createStem(input: { subjectId: number; name: string }): Promise<Stem[]>
  renameStem(input: { id: number; name: string }): Promise<Stem[]>
  setStemActive(input: { id: number; active: boolean }): Promise<Stem[]>
  moveStem(input: { id: number; direction: 'up' | 'down' }): Promise<Stem[]>

  listCourses(): Promise<Course[]>
  createCourse(input: { name: string; subjectId: number }): Promise<Course>
  updateCourse(input: { id: number; name: string }): Promise<Course>
  setCourseArchived(input: { id: number; archived: boolean }): Promise<void>

  listStudents(): Promise<StudentListItem[]>
  getStudent(id: number): Promise<Student>
  createStudent(input: { firstName: string; lastName: string; courseIds: number[] }): Promise<Student>
  updateStudent(input: { id: number; firstName: string; lastName: string }): Promise<Student>
  setStudentArchived(input: { id: number; archived: boolean }): Promise<void>
  updateStudentComments(input: { id: number } & Comments): Promise<void>
  setEnrollment(input: { studentId: number; courseId: number; active: boolean }): Promise<void>
  importRoster(input: { rows: RosterAction[]; courseIds: number[] }): Promise<RosterImportResult>

  getGradebook(courseId: number): Promise<CourseGradebook>
  createAssignment(input: { courseId: number } & AssignmentInput): Promise<GradebookAssignment>
  updateAssignment(input: { id: number } & AssignmentInput): Promise<GradebookAssignment>
  archiveAssignment(id: number): Promise<void>
  setRawScore(input: { assignmentId: number; studentId: number; rawScore: Score | null }): Promise<void>
  enrollStudents(input: { courseId: number; studentIds: number[] }): Promise<void>

  getStudentDashboard(id: number): Promise<StudentDashboard>

  /** Newest first. Without `studentId`, entries for every student. */
  listLogEntries(input: { archived: boolean; studentId?: number }): Promise<LogEntry[]>
  createLogEntry(input: { studentId: number; title: string; body: string }): Promise<LogEntry>
  updateLogEntry(input: { id: number; studentId: number; title: string; body: string }): Promise<LogEntry>
  setLogEntryArchived(input: { id: number; archived: boolean }): Promise<void>

  createBackup(): Promise<FileResult>
  restoreBackup(): Promise<RestoreResult>
  saveTextFile(input: { defaultName: string; content: string }): Promise<FileResult>
  pickRosterFile(): Promise<PickedFile>

  /** Load values to type into another app when the global hotkey is pressed. Replaces any previously armed column. */
  armTypingMacro(input: { values: string[]; label: string }): Promise<MacroArmed>
  disarmTypingMacro(): Promise<void>
}

export type ApiMethod = keyof Api

export const API_METHODS: readonly ApiMethod[] = [
  'getAppInfo', 'listSubjects', 'listStems', 'createStem', 'renameStem', 'setStemActive', 'moveStem',
  'listCourses', 'createCourse', 'updateCourse', 'setCourseArchived',
  'listStudents', 'getStudent', 'createStudent', 'updateStudent', 'setStudentArchived',
  'updateStudentComments', 'setEnrollment', 'importRoster',
  'getGradebook', 'createAssignment', 'updateAssignment', 'archiveAssignment', 'setRawScore', 'enrollStudents',
  'getStudentDashboard', 'listLogEntries', 'createLogEntry', 'updateLogEntry', 'setLogEntryArchived', 'createBackup', 'restoreBackup', 'saveTextFile', 'pickRosterFile',
  'armTypingMacro', 'disarmTypingMacro'
]

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }
