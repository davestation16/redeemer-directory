export type UserRole = 'admin' | 'member' | 'pending';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  familyId?: string;
  hasSeenTutorial?: boolean;
  createdAt: any;
  updatedAt: any;
}

export type FamilyMemberRole = 'Adult' | 'Teen' | 'Child';

export interface FamilyMember {
  name: string;
  phone?: string;
  email?: string;
  role: FamilyMemberRole;
  birthday?: string; // stored as ISO string or YYYY-MM-DD
}

export type PhotoStatus = 'pending' | 'approved' | 'rejected' | 'pending_invite';

export interface Family {
  id: string;
  familyName: string;
  members: FamilyMember[];
  address?: string;
  photoUrl?: string;
  photoStatus?: PhotoStatus;
  weddingAnniversary?: string; // YYYY-MM-DD
  initialMagicLink?: string;
  memberUids: string[];
  createdAt: any;
  updatedAt: any;
}

export interface Invite {
  id: string;
  code: string;
  used: boolean;
  usedBy?: string;
  createdAt: any;
  expiresAt?: any;
}

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
}

export interface InviteCode {
  id: string;
  code: string;
  familyId: string;
  familyName: string;
  maxUses: number;
  usedCount: number;
  invitedEmails: string[];
  status: 'active' | 'revoked';
  createdAt: any;
}

export interface SystemSettings {
  id: string;
  inviteEmailTemplate: {
    subject: string;
    body: string;
  };
  updatedAt: any;
}
