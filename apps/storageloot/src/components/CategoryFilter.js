const categories = [
  { value: 'all', label: 'All' },
  { value: 'tools', label: 'Tools' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'sports', label: 'Sports' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'household', label: 'Household' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'other', label: 'Other' },
];

export default function CategoryFilter({ selected, onChange }) {
  return (
    <div className="category-filter d-flex flex-wrap gap-1">
      {categories.map(cat => (
        <button
          key={cat.value}
          className={`btn btn-sm ${selected === cat.value ? 'btn-dark' : 'btn-outline-secondary'}`}
          onClick={() => onChange(cat.value)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
