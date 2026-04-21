export interface User {
  id: string;
  name: string;
  pin: string;
  enabled: boolean;
  slot: number;
  createdAt: string;
  updatedAt: string;
}

export interface UsersFile {
  version: 1;
  users: User[];
}

export interface UserInput {
  name: string;
  pin: string;
  enabled?: boolean;
}

export interface UserPatch {
  name?: string;
  pin?: string;
  enabled?: boolean;
}
