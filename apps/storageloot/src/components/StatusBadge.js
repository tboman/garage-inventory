const statusConfig = {
  active: { label: 'Active', className: 'badge-active' },
  sold: { label: 'Sold', className: 'badge-sold' },
  expired: { label: 'Expired', className: 'badge-expired' },
  draft: { label: 'Draft', className: 'badge-draft' },
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || { label: status, className: 'bg-secondary' };
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}
