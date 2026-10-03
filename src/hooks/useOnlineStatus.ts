import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConnectivityStatus {
  isOnline: boolean;
  hasReconnected: boolean;
  reconnectedAt: string | null;
  dismissReconnected: () => void;
  triggerOffline: () => void;
  triggerOnline: () => void;
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function useConnectivityTransition(): ConnectivityStatus {
  const initialOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const [isOnline, setIsOnline] = useState<boolean>(initialOnline);
  const [hasReconnected, setHasReconnected] = useState<boolean>(false);
  const [reconnectedAt, setReconnectedAt] = useState<string | null>(null);
  const wasOfflineRef = useRef<boolean>(!initialOnline);

  useEffect(() => {
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
      setHasReconnected(false);
    };

    const handleOnline = () => {
      // Transition from offline to online (or explicit online event dispatch)
      wasOfflineRef.current = false;
      setIsOnline(true);
      setHasReconnected(true);
      setReconnectedAt(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const dismissReconnected = useCallback(() => {
    setHasReconnected(false);
  }, []);

  const triggerOffline = useCallback(() => {
    window.dispatchEvent(new Event('offline'));
  }, []);

  const triggerOnline = useCallback(() => {
    window.dispatchEvent(new Event('online'));
  }, []);

  return {
    isOnline,
    hasReconnected,
    reconnectedAt,
    dismissReconnected,
    triggerOffline,
    triggerOnline,
  };
}
