import { useState, useEffect } from 'react';
import { subscribeConversations, isUnread } from '../messagesApi';

// Live list of the signed-in person's conversations, with an unread count.
export function useConversations(user) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    return subscribeConversations(
      user.uid,
      (list) => { setConversations(list); setLoading(false); setError(null); },
      (e) => { setError(e.message); setLoading(false); },
    );
  }, [user]);

  const unread = user ? conversations.filter((c) => isUnread(c, user.uid)).length : 0;
  return { conversations, unread, loading, error };
}
