import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { currentPassword, newPassword } = body

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Both passwords required' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: 'New password must be different' }, { status: 400 })
  }

  try {
    // Fetch current hash
    const [user] = await sql`SELECT id, password_hash FROM users WHERE id = ${session.user.id}`
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
    }

    // Hash and update
    const hash = await bcrypt.hash(newPassword, 12)
    await sql`
      UPDATE users SET password_hash = ${hash}, temp_password = false, updated_at = NOW()
      WHERE id = ${session.user.id}
    `

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[POST /api/auth/change-password] Error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
