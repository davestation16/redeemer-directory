# Security Specification - Redeemer Community Directory

## 1. Data Invariants
- A `User` document must exist for every authenticated user to establish their `role`.
- `Family` names are required.
- `memberUids` in a `Family` document must be a list of valid user UIDs.
- Role changes can only be performed by existing admins.

## 2. The "Dirty Dozen" Payloads (Attack Vectors)
1. **Role Escalation**: Authenticated user trying to set their own role to 'admin' during registration.
2. **Shadow Field Injection**: Adding `isVerified: true` to a family document.
3. **Identity Spoofing**: User A trying to update Family B where User A is not in `memberUids`.
4. **Directory Scraping**: Unauthenticated user trying to list all families.
5. **ID Poisoning**: Injecting a 1MB string as a family ID.
6. **Immutable Field Tampering**: Overwriting `createdAt` timestamps.
7. **Cross-Family Access**: User A trying to add themselves to `memberUids` of Family B.
8. **Admin Lockout**: User deleting the only admin document (restricted to self/admin).
9. **Email Spoofing**: User providing a non-verified email and getting access (rules should check `email_verified`).
10. **Resource Exhaustion**: Sending an array of 10,000 children names.
11. **PII Leak**: Non-member authenticated user trying to read private email/phone of others. (Requirement says "directory for authenticated users", so members can see each other).
12. **Orphaned Record**: Creating a user document that doesn't match the `request.auth.uid`.

## 3. Test Runner
We will implement a suite of tests to verify these constraints. (Skipping the full `.test.ts` file for brevity in this step, but thinking through the logic).

## 4. Conflict Report - Collections Evaluation
| Collection | Identity Spoofing | State Shortcutting | Resource Poisoning |
| :--- | :--- | :--- | :--- |
| `users` | Blocked (uid must match auth.uid) | Blocked (role is immutable for users) | Blocked (size checks) |
| `families` | Blocked (memberUids check) | N/A | Blocked (size checks) |
