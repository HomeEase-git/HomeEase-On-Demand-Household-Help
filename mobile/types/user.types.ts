export type UserRole = 'client' | 'worker';

export type User = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatarUri?: string;
};
