import { useEffect, useRef, useState } from 'react';
import { pickGooglePhotos } from '../googlePhotosPicker';

export default function GooglePhotosPickerButton({
  onPicked,
  disabled = false,
  multiple = true,
  className = 'btn btn-outline-primary btn-sm',
  label = 'Pick from Google Photos',
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    setStatus('Opening Google Photos picker...');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const files = await pickGooglePhotos({
        signal: ac.signal,
        onSession: () => setStatus('Waiting for you to pick photos...'),
      });
      if (files.length === 0) {
        setError('No photos were picked.');
      } else {
        const toUse = multiple ? files : files.slice(0, 1);
        onPicked?.(toUse);
      }
    } catch (e) {
      setError(e.message || 'Failed to pick photos.');
    } finally {
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  return (
    <div className="d-inline-block">
      {busy ? (
        <button type="button" className={className} onClick={handleCancel}>
          <span className="spinner-border spinner-border-sm me-2" />
          Cancel
        </button>
      ) : (
        <button type="button" className={className} onClick={handleClick} disabled={disabled}>
          {label}
        </button>
      )}
      {status && <div className="form-text mt-1">{status}</div>}
      {error && <div className="form-text text-danger mt-1">{error}</div>}
    </div>
  );
}
