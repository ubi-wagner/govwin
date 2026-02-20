import type { UserRole } from '@/types'

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
    }
  }
}
