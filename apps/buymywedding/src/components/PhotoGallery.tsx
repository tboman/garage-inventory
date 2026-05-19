import React, { useState, useRef, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, addDoc, query, where, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { UploadedFile } from './PhotoUploader';

// Use storagePath as the stable imageId when available, fall back to local id
function imageId(file: UploadedFile): string {
  return file.storagePath ?? file.id;
}
import './PhotoGallery.css';

interface PhotoGalleryProps {
  files: UploadedFile[];
  onDelete: (file: UploadedFile) => void;
}

interface Tag {
  id?: string;
  x: number;
  y: number;
  description: string;
  price?: string;
  ebayItemNumber?: string;
  craigslistUrl?: string;
  userId: string;
  imageId: string;
}

type NewTagData = Omit<Tag, 'id'>;

interface ImageTags {
  [imageId: string]: Tag[];
}

const PhotoGallery: React.FC<PhotoGalleryProps> = ({ files, onDelete }) => {
  const [selectedImage, setSelectedImage] = useState<UploadedFile | null>(null);
  const [imageTags, setImageTags] = useState<ImageTags>({});
  const [newTagPosition, setNewTagPosition] = useState<{ x: number; y: number } | null>(null);
  const [newTagDescription, setNewTagDescription] = useState('');
  const [newTagPrice, setNewTagPrice] = useState('');
  const [newTagEbayItem, setNewTagEbayItem] = useState('');
  const [newTagCraigslistUrl, setNewTagCraigslistUrl] = useState('');
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UploadedFile | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (selectedImage?.id === pendingDelete.id) setSelectedImage(null);
    onDelete(pendingDelete);
    setPendingDelete(null);
  };

  useEffect(() => {
    const fetchTags = async () => {
      if (selectedImage && auth.currentUser) {
        const imgId = imageId(selectedImage);
        const q = query(
          collection(db, 'tags'),
          where('userId', '==', auth.currentUser.uid),
          where('imageId', '==', imgId)
        );
        const snapshot = await getDocs(q);
        const fetched: Tag[] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Tag));
        setImageTags((prev) => ({ ...prev, [imgId]: fetched }));
      }
    };
    fetchTags();
  }, [selectedImage]);

  // Deselect if the selected image is removed
  useEffect(() => {
    if (selectedImage && !files.find((f) => f.id === selectedImage.id)) {
      setSelectedImage(null);
    }
  }, [files, selectedImage]);

  const handleImageClick = (file: UploadedFile) => {
    setSelectedImage(file);
    setNewTagPosition(null);
    setNewTagDescription('');
    setNewTagPrice('');
    setNewTagEbayItem('');
    setNewTagCraigslistUrl('');
  };

  const handleImageClickForTagging = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedImage || !imageRef.current) return;
    setEditingTag(null);
    const rect = imageRef.current.getBoundingClientRect();
    setNewTagPosition({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
    setNewTagDescription('');
    setNewTagPrice('');
    setNewTagEbayItem('');
    setNewTagCraigslistUrl('');
  };

  const startEditTag = (tag: Tag) => {
    setNewTagPosition(null);
    setEditingTag(tag);
    setNewTagDescription(tag.description);
    setNewTagPrice(tag.price || '');
    setNewTagEbayItem(tag.ebayItemNumber || '');
    setNewTagCraigslistUrl(tag.craigslistUrl || '');
  };

  const saveEditTag = async () => {
    if (!editingTag?.id || !selectedImage || !newTagDescription.trim()) return;
    const updates = {
      description: newTagDescription.trim(),
      price: newTagPrice.trim() || null,
      ebayItemNumber: newTagEbayItem.trim() || null,
      craigslistUrl: newTagCraigslistUrl.trim() || null,
    };
    try {
      await updateDoc(doc(db, 'tags', editingTag.id), updates);
      const localUpdates: Partial<Tag> = {
        description: newTagDescription.trim(),
        price: newTagPrice.trim() || undefined,
        ebayItemNumber: newTagEbayItem.trim() || undefined,
        craigslistUrl: newTagCraigslistUrl.trim() || undefined,
      };
      const imgId = imageId(selectedImage);
      setImageTags((prev) => ({
        ...prev,
        [imgId]: (prev[imgId] || []).map((t) =>
          t.id === editingTag.id ? { ...t, ...localUpdates } : t
        ),
      }));
      setEditingTag(null);
    } catch (e) {
      console.error('Error updating tag:', e);
    }
  };

  const deleteTag = async () => {
    if (!editingTag?.id || !selectedImage) return;
    try {
      await deleteDoc(doc(db, 'tags', editingTag.id));
      const imgId = imageId(selectedImage);
      setImageTags((prev) => ({
        ...prev,
        [imgId]: (prev[imgId] || []).filter((t) => t.id !== editingTag.id),
      }));
      setEditingTag(null);
    } catch (e) {
      console.error('Error deleting tag:', e);
    }
  };

  const addTag = async () => {
    if (!selectedImage || !newTagPosition || !newTagDescription.trim() || !auth.currentUser) return;
    const data: NewTagData = {
      userId: auth.currentUser.uid,
      imageId: imageId(selectedImage),
      x: newTagPosition.x,
      y: newTagPosition.y,
      description: newTagDescription.trim(),
      ...(newTagPrice.trim() && { price: newTagPrice.trim() }),
      ...(newTagEbayItem.trim() && { ebayItemNumber: newTagEbayItem.trim() }),
      ...(newTagCraigslistUrl.trim() && { craigslistUrl: newTagCraigslistUrl.trim() }),
    };
    try {
      const docRef = await addDoc(collection(db, 'tags'), data);
      const imgId = imageId(selectedImage);
      setImageTags((prev) => ({
        ...prev,
        [imgId]: [...(prev[imgId] || []), { id: docRef.id, ...data }],
      }));
      setNewTagPosition(null);
      setNewTagDescription('');
      setNewTagPrice('');
      setNewTagEbayItem('');
      setNewTagCraigslistUrl('');
    } catch (e) {
      console.error('Error saving tag:', e);
    }
  };

  if (files.length === 0) return null;

  return (
    <div className="gallery">
      {/* Thumbnail strip */}
      <div className="gallery__strip">
        {files.map((file) => (
          <div
            key={file.id}
            className={`gallery__strip-item${selectedImage?.id === file.id ? ' gallery__strip-item--active' : ''}${file.uploadState === 'uploading' ? ' gallery__strip-item--uploading' : ''}`}
            onClick={() => file.uploadState !== 'uploading' && handleImageClick(file)}
          >
            <img src={file.url} alt={file.name} className="gallery__strip-thumb" />
            {file.uploadState === 'uploading' && (
              <div className="gallery__strip-overlay">
                <div className="gallery__strip-spinner" />
              </div>
            )}
            {file.uploadState === 'error' && (
              <div className="gallery__strip-badge gallery__strip-badge--error" title="Upload failed">!</div>
            )}
            {file.uploadState !== 'uploading' && (
              <button
                className="gallery__strip-delete"
                onClick={(e) => { e.stopPropagation(); setPendingDelete(file); }}
                aria-label={`Delete ${file.name}`}
                title="Delete photo"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Full-size tagging view */}
      {selectedImage && (
        <div className="gallery__tagger">
          <p className="gallery__tagger-hint">Click anywhere on the image to tag an item for sale</p>
          <div
            className="gallery__tagger-canvas"
            onClick={handleImageClickForTagging}
          >
            <img
              src={selectedImage.url}
              alt={selectedImage.name}
              className="gallery__tagger-img"
              ref={imageRef}
            />

            {/* Existing tags */}
            {imageTags[imageId(selectedImage)]?.map((tag, i) => (
              <div
                key={tag.id || i}
                className={`gallery__tag${editingTag?.id === tag.id ? ' gallery__tag--editing' : ''}`}
                style={tag.x > 1 || tag.y > 1
                  ? { left: tag.x, top: tag.y }
                  : { left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
                title={tag.price ? `${tag.description} — ${tag.price}` : tag.description}
                onClick={(e) => { e.stopPropagation(); startEditTag(tag); }}
              >
                <span className="gallery__tag-dot">{i + 1}</span>
                {editingTag?.id !== tag.id && (
                  <div className="gallery__tag-tooltip">
                    <strong>{tag.description}</strong>
                    {tag.price && <span>{tag.price}</span>}
                    {tag.ebayItemNumber && (
                      <a
                        href={`https://www.ebay.com/itm/${tag.ebayItemNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="gallery__tag-ebay-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View on eBay
                      </a>
                    )}
                    {tag.craigslistUrl && (
                      <a
                        href={tag.craigslistUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="gallery__tag-ebay-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Craigslist
                      </a>
                    )}
                  </div>
                )}
                {editingTag?.id === tag.id && (
                  <div className="gallery__tag-form gallery__tag-form--edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="gallery__tag-input"
                      type="text"
                      placeholder="Item name"
                      value={newTagDescription}
                      onChange={(e) => setNewTagDescription(e.target.value)}
                      autoFocus
                    />
                    <input
                      className="gallery__tag-input"
                      type="text"
                      placeholder="Price (e.g. £120)"
                      value={newTagPrice}
                      onChange={(e) => setNewTagPrice(e.target.value)}
                    />
                    <input
                      className="gallery__tag-input"
                      type="text"
                      placeholder="eBay item number (optional)"
                      value={newTagEbayItem}
                      onChange={(e) => setNewTagEbayItem(e.target.value)}
                    />
                    <input
                      className="gallery__tag-input"
                      type="text"
                      placeholder="Craigslist URL (optional)"
                      value={newTagCraigslistUrl}
                      onChange={(e) => setNewTagCraigslistUrl(e.target.value)}
                    />
                    <div className="gallery__tag-form-actions">
                      <button className="gallery__tag-save" onClick={saveEditTag}>Update</button>
                      <button className="gallery__tag-cancel" onClick={() => setEditingTag(null)}>Cancel</button>
                      <button className="gallery__tag-delete" onClick={deleteTag}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* New tag popover */}
            {newTagPosition && (
              <div
                className="gallery__tag-form"
                style={{ left: `${newTagPosition.x * 100}%`, top: `${newTagPosition.y * 100}%` }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  className="gallery__tag-input"
                  type="text"
                  placeholder="Item name"
                  value={newTagDescription}
                  onChange={(e) => setNewTagDescription(e.target.value)}
                  autoFocus
                />
                <input
                  className="gallery__tag-input"
                  type="text"
                  placeholder="Price (e.g. £120)"
                  value={newTagPrice}
                  onChange={(e) => setNewTagPrice(e.target.value)}
                />
                <input
                  className="gallery__tag-input"
                  type="text"
                  placeholder="eBay item number (optional)"
                  value={newTagEbayItem}
                  onChange={(e) => setNewTagEbayItem(e.target.value)}
                />
                <input
                  className="gallery__tag-input"
                  type="text"
                  placeholder="Craigslist URL (optional)"
                  value={newTagCraigslistUrl}
                  onChange={(e) => setNewTagCraigslistUrl(e.target.value)}
                />
                <div className="gallery__tag-form-actions">
                  <button className="gallery__tag-save" onClick={addTag}>Save tag</button>
                  <button className="gallery__tag-cancel" onClick={() => setNewTagPosition(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Confirmation modal */}
      {pendingDelete && (
        <div className="gallery__modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="gallery__modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="gallery__modal-title">Delete photo?</h3>
            <p className="gallery__modal-body">
              <strong>{pendingDelete.name}</strong> will be permanently removed from your gallery. This cannot be undone.
            </p>
            <div className="gallery__modal-actions">
              <button className="gallery__modal-cancel" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button className="gallery__modal-confirm" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoGallery;
