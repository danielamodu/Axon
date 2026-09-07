import { z } from 'zod'

export const SpellActionSchema = z.object({
  target: z.string(),
  signature: z.string(),
  calldata: z.string(),
  description: z.string().optional(),
})

export const SpellRecordSchema = z.object({
  spellAddress: z.string(),
  calledAt: z.date(),
  earliestExecution: z.date(),
  latestExecution: z.date(),
  officeHoursActive: z.boolean(),
  nextExecutionWindow: z.date(),
  calldata: z.string(),
  actions: z.array(SpellActionSchema),
})

export type SpellAction = z.infer<typeof SpellActionSchema>
export type SpellRecord = z.infer<typeof SpellRecordSchema>
