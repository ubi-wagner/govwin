/**
 * Augment NextAuth types with our custom session fields.
 * Ensures session.user.role, session.user.tenantId, etc. are typed.
 */
import type { UserRole } from '@/types'
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface User {
    role?: UserRole
    tenantId?: string | null
    tempPassword?: boolean
  }

  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      role: UserRole
      tenantId: string | null
      tempPassword: boolean
    } & DefaultSession['user']
  }
}
