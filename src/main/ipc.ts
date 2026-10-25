import { z } from 'zod'
import { ipcMain } from 'electron'
import type { Api, ApiEnvelope, ApiMethod } from '@shared/types'
import { API_METHODS } from '@shared/types'
import { AppError } from './db/connection'

const id = z.number().int().positive()
const text = (max: number) => z.string().max(max)
const name = text(200)
const stemIds = z.array(id).max(100)
const assignment = {
  name, maxPoints: z.number().finite(), weight: z.number().finite(), dueDate: z.string(), stemIds
}
const comments = { positiveComment1: text(5000), positiveComment2: text(5000), growthComment: text(5000) }

/** Input schemas, one per channel. Every handler parses its arguments through these. */
export const schemas = {
  getAppInfo: z.tuple([]),
  listSubjects: z.tuple([]),
  listStems: z.tuple([]),
  createStem: z.tuple([z.object({ subjectId: id, name })]),
  renameStem: z.tuple([z.object({ id, name })]),
  setStemActive: z.tuple([z.object({ id, active: z.boolean() })]),
  moveStem: z.tuple([z.object({ id, direction: z.enum(['up', 'down']) })]),
  listCourses: z.tuple([]),
  createCourse: z.tuple([z.object({ name, subjectId: id })]),
  updateCourse: z.tuple([z.object({ id, name })]),
  setCourseArchived: z.tuple([z.object({ id, archived: z.boolean() })]),
  listStudents: z.tuple([]),
  getStudent: z.tuple([id]),
  createStudent: z.tuple([z.object({ firstName: name, lastName: name, courseIds: z.array(id).max(100) })]),
  updateStudent: z.tuple([z.object({ id, firstName: name, lastName: name })]),
  setStudentArchived: z.tuple([z.object({ id, archived: z.boolean() })]),
  updateStudentComments: z.tuple([z.object({ id, ...comments })]),
  setEnrollment: z.tuple([z.object({ studentId: id, courseId: id, active: z.boolean() })]),
  importRoster: z.tuple([
    z.object({
      rows: z
        .array(
          z.discriminatedUnion('action', [
            z.object({ action: z.literal('create'), firstName: name, lastName: name }),
            z.object({ action: z.literal('existing'), studentId: id })
          ])
        )
        .max(5000),
      courseIds: z.array(id).max(100)
    })
  ]),
  getGradebook: z.tuple([id]),
  createAssignment: z.tuple([z.object({ courseId: id, ...assignment })]),
  updateAssignment: z.tuple([z.object({ id, ...assignment })]),
  archiveAssignment: z.tuple([id]),
  setRawScore: z.tuple([z.object({ assignmentId: id, studentId: id, rawScore: z.union([z.number().finite(), z.enum(['M', 'E'])]).nullable() })]),
  enrollStudents: z.tuple([z.object({ courseId: id, studentIds: z.array(id).max(500) })]),
  getStudentDashboard: z.tuple([id]),
  createBackup: z.tuple([]),
  restoreBackup: z.tuple([]),
  saveTextFile: z.tuple([z.object({ defaultName: text(200), content: text(20_000_000) })]),
  pickRosterFile: z.tuple([]),
  armTypingMacro: z.tuple([
    z.object({ values: z.array(z.string().regex(/^(\d+(\.\d+)?|MI|EX|IN)$/)).max(1000), label: name })
  ]),
  disarmTypingMacro: z.tuple([])
} satisfies Record<ApiMethod, z.ZodType>

export type Handlers = { [K in ApiMethod]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Awaited<ReturnType<Api[K]>> }

export function registerIpc(handlers: Handlers): void {
  for (const method of API_METHODS) {
    ipcMain.handle(`api:${method}`, async (_event, ...args: unknown[]): Promise<ApiEnvelope<unknown>> => {
      try {
        const parsed = schemas[method].safeParse(args)
        if (!parsed.success) throw new AppError('Invalid request.')
        const fn = handlers[method] as (...a: unknown[]) => unknown
        return { ok: true, data: await fn(...(parsed.data as unknown[])) }
      } catch (error) {
        if (!(error instanceof AppError)) console.error(`[ipc ${method}]`, error)
        return { ok: false, error: error instanceof AppError ? error.message : 'Something went wrong. Your data was not changed.' }
      }
    })
  }
}
