import React, { useState, useEffect } from 'react';
import { extractFileIdFromUrl } from '../driveApi';
import { getCachedGoogleToken, subscribeGoogleToken } from '../googleToken';

const blobCache = new Map();

const DriveImage = ({ src, alt, ...props }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(false);
  // Bumped whenever the Drive token changes, so reconnecting retries every image.
  const [tokenEpoch, setTokenEpoch] = useState(0);

  const fileId = src ? extractFileIdFromUrl(src) : null;

  useEffect(() => subscribeGoogleToken(() => setTokenEpoch(n => n + 1)), []);

  useEffect(() => {
    if (!fileId) return;

    if (blobCache.has(fileId)) {
      setBlobUrl(blobCache.get(fileId));
      return;
    }

    // Rendering must never open a sign-in popup: a screen full of photos mounts
    // many of these at once, and a popup with no user gesture behind it is
    // blocked anyway. Show the placeholder and wait for the reconnect banner.
    const token = getCachedGoogleToken();
    if (!token) {
      setError(true);
      return;
    }

    let cancelled = false;
    setError(false);

    (async () => {
      try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobCache.set(fileId, url);
        if (!cancelled) setBlobUrl(url);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => { cancelled = true; };
  }, [fileId, tokenEpoch]);

  if (error) {
    return <div {...props} style={{ ...props.style, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i className="fas fa-image text-muted"></i></div>;
  }

  // Non-Drive URL (legacy Firebase Storage) — use directly
  if (!fileId) {
    return <img src={src} alt={alt} {...props} />;
  }

  if (!blobUrl) {
    return <div {...props} style={{ ...props.style, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner-border spinner-border-sm text-muted" role="status"></span></div>;
  }

  return <img src={blobUrl} alt={alt} {...props} />;
};

export default DriveImage;
