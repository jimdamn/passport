import { createContext, useContext } from 'react';

interface ProfilePanelContextValue {
  openProfile: (onSaved?: () => void) => void;
}

const ProfilePanelContext = createContext<ProfilePanelContextValue>({
  openProfile: () => {},
});

export const ProfilePanelProvider = ProfilePanelContext.Provider;

export function useProfilePanel(): ProfilePanelContextValue {
  return useContext(ProfilePanelContext);
}
