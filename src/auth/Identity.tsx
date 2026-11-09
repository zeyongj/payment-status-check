import { createContext, useContext, type ReactNode } from 'react';

export interface Identity {
  userId: string | null;
  loaded: boolean;
  getToken: () => Promise<string | null>;
  controls: ReactNode;
}

export const IdentityContext = createContext<Identity>({
  userId: null,
  loaded: true,
  getToken: async () => null,
  controls: null,
});

export const useIdentity = () => useContext(IdentityContext);
