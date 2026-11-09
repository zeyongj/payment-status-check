import React, { createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import App from './App';
import './styles.css';

export interface Identity {
  userId: string | null;
  loaded: boolean;
  getToken: () => Promise<string | null>;
  controls: React.ReactNode;
}
const IdentityContext = createContext<Identity>({
  userId: null,
  loaded: true,
  getToken: async () => null,
  controls: null,
});
export const useIdentity = () => useContext(IdentityContext);

function ConnectedApp() {
  const { userId, isLoaded, getToken } = useAuth();
  const { user } = useUser();
  const controls = user ? (
    <UserButton />
  ) : (
    <SignInButton mode="modal">
      <button className="small">Sign in · 登录</button>
    </SignInButton>
  );
  return (
    <IdentityContext.Provider
      value={{ userId: userId ?? null, loaded: isLoaded, getToken, controls }}
    >
      <App />
    </IdentityContext.Provider>
  );
}

const publishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {publishableKey ? (
      <ClerkProvider publishableKey={publishableKey}>
        <ConnectedApp />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
