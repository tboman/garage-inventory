import { useRef, useState, useCallback } from 'react';
import { uploadToStorage } from '../lib/storageUpload';
import './PhotoUploader.css';

export type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export interface UploadedFile {
  id: string;            // stable local id (name-size-lastModified)
  name: string;
  url: string;           // blob URL initially, then Firebase Storage download URL
  storagePath?: string;  // set after successful upload
  uploadState: UploadState;
}

interface PhotoUploaderProps {
  files: UploadedFile[];
  onChange: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
}

function makeLocalFile(file: File): UploadedFile {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    url: URL.createObjectURL(file),
    uploadState: 'idle',
  };
}

export default function PhotoUploader({ files, onChange }: PhotoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const updateFile = useCallback(
    (id: string, patch: Partial<UploadedFile>) => {
      // Functional updater — always operates on latest state, never a stale snapshot
      onChange((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [onChange]
  );

  const uploadFile = useCallback(
    async (uploaded: UploadedFile, raw: File) => {
      updateFile(uploaded.id, { uploadState: 'uploading' });
      try {
        const { storagePath, url } = await uploadToStorage(raw, uploaded.id);
        // Revoke blob URL now that we have a permanent one
        URL.revokeObjectURL(uploaded.url);
        updateFile(uploaded.id, { storagePath, url, uploadState: 'done' });
      } catch (err) {
        console.error('Storage upload error:', err);
        updateFile(uploaded.id, { uploadState: 'error' });
      }
    },
    [updateFile]
  );

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;
      const existingIds = new Set(files.map((f) => f.id));
      const toAdd: { uploaded: UploadedFile; raw: File }[] = [];

      for (const raw of Array.from(incoming)) {
        if (!raw.type.startsWith('image/')) continue;
        const uploaded = makeLocalFile(raw);
        if (!existingIds.has(uploaded.id)) toAdd.push({ uploaded, raw });
      }

      if (toAdd.length === 0) return;
      onChange((prev) => [...prev, ...toAdd.map((t) => t.uploaded)]);
      toAdd.forEach(({ uploaded, raw }) => uploadFile(uploaded, raw));
    },
    [files, onChange, uploadFile]
  );

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="uploader">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />

      {/* Drop zone */}
      <div
        className={`uploader__dropzone${dragging ? ' uploader__dropzone--active' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        aria-label="Upload photos"
      >
        <div className="uploader__dropzone-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p className="uploader__dropzone-text">Drag photos here, or click to browse</p>
        <p className="uploader__dropzone-sub">PNG, JPG, WEBP — stored securely in the cloud</p>
      </div>

      {/* Buttons */}
      <div className="uploader__actions">
        <button
          type="button"
          className="uploader__btn"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Choose from device
        </button>
        <button
          type="button"
          className="uploader__btn"
          onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          Take a photo
        </button>
      </div>

    </div>
  );
}
