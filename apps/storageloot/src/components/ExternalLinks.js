const platformConfig = {
  ebay: { label: 'eBay', color: 'primary' },
  craigslist: { label: 'Craigslist', color: 'purple' },
  facebook: { label: 'Facebook', color: 'primary' },
  offerup: { label: 'OfferUp', color: 'success' },
  other: { label: 'Link', color: 'secondary' },
};

export default function ExternalLinks({ links }) {
  if (!links?.length) return null;

  return (
    <div className="d-flex flex-wrap gap-2">
      {links.map((link, i) => {
        const config = platformConfig[link.platform] || platformConfig.other;
        return (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn btn-outline-${config.color} btn-sm external-link-btn`}
          >
            {config.label} &#8599;
          </a>
        );
      })}
    </div>
  );
}
