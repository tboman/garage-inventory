import { useState, useRef } from 'react';
import PhotoPreview from './PhotoPreview';

const conditions = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
];

const categories = [
  { value: 'tools', label: 'Tools' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'sports', label: 'Sports' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'household', label: 'Household' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'other', label: 'Other' },
];

const platforms = [
  { value: 'ebay', label: 'eBay' },
  { value: 'craigslist', label: 'Craigslist' },
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'offerup', label: 'OfferUp' },
  { value: 'other', label: 'Other' },
];

export default function ListingForm({ initial = {}, onSubmit, submitLabel = 'Publish Listing', loading = false, photoUrls: initialPhotoUrls, myGroups = [] }) {
  const [title, setTitle] = useState(initial.title || '');
  const [description, setDescription] = useState(initial.description || '');
  const [priceDollars, setPriceDollars] = useState(initial.price ? (initial.price / 100).toFixed(2) : '');
  const [condition, setCondition] = useState(initial.condition || 'good');
  const [category, setCategory] = useState(initial.category || 'other');
  const [groupId, setGroupId] = useState(initial.groupId || '');
  const [externalLinks, setExternalLinks] = useState(initial.externalLinks || []);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoUrls, setPhotoUrls] = useState(initialPhotoUrls || initial.photos || []);
  const fileInput = useRef();

  const handleAddLink = () => {
    setExternalLinks([...externalLinks, { platform: 'ebay', url: '' }]);
  };

  const handleLinkChange = (i, field, value) => {
    const updated = [...externalLinks];
    updated[i] = { ...updated[i], [field]: value };
    setExternalLinks(updated);
  };

  const handleRemoveLink = (i) => {
    setExternalLinks(externalLinks.filter((_, idx) => idx !== i));
  };

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files);
    const remaining = 10 - photoUrls.length - photoFiles.length;
    const toAdd = files.slice(0, remaining);

    setPhotoFiles(prev => [...prev, ...toAdd]);
    toAdd.forEach(f => {
      const url = URL.createObjectURL(f);
      setPhotoUrls(prev => [...prev, url]);
    });
    e.target.value = '';
  };

  const handleRemovePhoto = (i) => {
    const isExisting = i < (initialPhotoUrls || initial.photos || []).length;
    if (!isExisting) {
      const fileIdx = i - (initialPhotoUrls || initial.photos || []).length;
      setPhotoFiles(prev => prev.filter((_, idx) => idx !== fileIdx));
    }
    setPhotoUrls(prev => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const priceInCents = Math.round(parseFloat(priceDollars) * 100);
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      price: priceInCents,
      currency: 'USD',
      condition,
      category,
      groupId: groupId || null,
      externalLinks: externalLinks.filter(l => l.url.trim()),
      photoFiles,
      existingPhotos: initialPhotoUrls || initial.photos || [],
    });
  };

  const isValid = title.trim() && priceDollars && parseFloat(priceDollars) > 0 && condition && category;

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label fw-semibold">Title</label>
        <input
          type="text"
          className="form-control"
          maxLength={120}
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          placeholder="What are you selling?"
        />
        <div className="form-text">{title.length}/120</div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold">Description</label>
        <textarea
          className="form-control"
          rows={4}
          maxLength={2000}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the item, its condition, any defects..."
        />
        <div className="form-text">{description.length}/2000</div>
      </div>

      <div className="row mb-3">
        <div className="col-sm-4">
          <label className="form-label fw-semibold">Price (USD)</label>
          <div className="input-group">
            <span className="input-group-text">$</span>
            <input
              type="number"
              className="form-control"
              min="0.01"
              step="0.01"
              value={priceDollars}
              onChange={e => setPriceDollars(e.target.value)}
              required
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="col-sm-4">
          <label className="form-label fw-semibold">Condition</label>
          <select className="form-select" value={condition} onChange={e => setCondition(e.target.value)}>
            {conditions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="col-sm-4">
          <label className="form-label fw-semibold">Category</label>
          <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
            {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold">Group <span className="text-muted fw-normal">(optional)</span></label>
        <select className="form-select" value={groupId} onChange={e => setGroupId(e.target.value)}>
          <option value="">None</option>
          {myGroups.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <div className="form-text">Assign this listing to one of your groups so it shows on the home page.</div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold">Photos (max 10)</label>
        <PhotoPreview photos={photoUrls} onRemove={handleRemovePhoto} />
        {photoUrls.length < 10 && (
          <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={() => fileInput.current.click()}>
            + Add Photos
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={handlePhotoSelect} />
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold">External Listings</label>
        <div className="form-text mb-2">Link to your eBay, Craigslist, or other listings</div>
        {externalLinks.map((link, i) => (
          <div key={i} className="input-group mb-2">
            <select
              className="form-select"
              style={{ maxWidth: '160px' }}
              value={link.platform}
              onChange={e => handleLinkChange(i, 'platform', e.target.value)}
            >
              {platforms.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input
              type="url"
              className="form-control"
              placeholder="https://..."
              value={link.url}
              onChange={e => handleLinkChange(i, 'url', e.target.value)}
            />
            <button type="button" className="btn btn-outline-danger" onClick={() => handleRemoveLink(i)}>
              &times;
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleAddLink}>
          + Add Link
        </button>
      </div>

      <button type="submit" className="btn btn-sl btn-lg w-100" disabled={!isValid || loading}>
        {loading ? (
          <><span className="spinner-border spinner-border-sm me-2"></span>Publishing...</>
        ) : submitLabel}
      </button>
    </form>
  );
}
