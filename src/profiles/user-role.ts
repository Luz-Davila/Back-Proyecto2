export const USER_ROLES = ['teacher', 'student'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function parseUserRole(value: unknown): UserRole | undefined {
  return value === 'teacher' || value === 'student' ? value : undefined;
}
