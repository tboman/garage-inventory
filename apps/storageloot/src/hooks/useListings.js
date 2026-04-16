import { useState, useEffect, useCallback } from 'react';
import { getListings } from '../api';

export function useListings({ category, searchKeyword } = {}) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await getListings({ category, searchKeyword });
      setListings(results);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [category, searchKeyword]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  return { listings, loading, error, refetch: fetchListings };
}
