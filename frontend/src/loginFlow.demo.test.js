import { describe, expect, it } from 'vitest'
import { auth, getDriverId, getRoute, loginDriver, logoutDriver } from './firebase'

describe('Live demo login flow (driver + admin)', () => {
  it('authenticates driver_001 and admin, and validates the seeded driver route size', async () => {
    // Arrange: use the seeded credentials used by this project for live-demo accounts.
    const driverCredentials = { id: 'driver_001', password: 'damm2026' }
    const adminCredentials = { id: 'admin', password: 'dammadmin2026' }
    await logoutDriver().catch(() => {})

    // Act: log in as driver_001 through the existing Firebase auth flow.
    const driverUser = await loginDriver(driverCredentials.id, driverCredentials.password)
    const driverId = getDriverId(driverUser)

    // Assert: driver login is valid and resolves to driver dashboard state.
    expect(driverUser).toBeTruthy()
    expect(auth.currentUser?.email).toBe('driver_001@interhack.bcn')
    expect(driverId).toBe('driver_001')
    expect(driverId === 'admin').toBe(false)

    // Act: switch session and log in as admin with the seeded admin account.
    await logoutDriver()
    const adminUser = await loginDriver(adminCredentials.id, adminCredentials.password)
    const adminId = getDriverId(adminUser)

    // Assert: admin login is valid and resolves to admin dashboard/authenticated state.
    expect(adminUser).toBeTruthy()
    expect(auth.currentUser?.email).toBe('admin@interhack.bcn')
    expect(adminId).toBe('admin')
    expect(adminId === 'admin').toBe(true)

    // Act: return to driver_001 and read assigned route from Firestore.
    await logoutDriver()
    await loginDriver(driverCredentials.id, driverCredentials.password)
    const driverRoute = await getRoute(driverCredentials.id)

    // Assert: demo route contains the expected realistic number of stops (~5).
    expect(Array.isArray(driverRoute?.points)).toBe(true)
    expect(driverRoute.points.length).toBeGreaterThanOrEqual(5)

    // Assert/Cleanup: finish with a clean session so repeated demo runs stay stable.
    await logoutDriver()
  })
})
