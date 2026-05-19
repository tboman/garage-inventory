import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase';
import './LandingPage.css';

/* ──────────────────────────────────────────────────────────
   Data
   ────────────────────────────────────────────────────────── */

interface Listing {
  id: string;
  url: string;
  storagePath: string;
  name: string;
}

interface Tag {
  id: string;
  description: string;
  price?: string;
  ebayItemNumber?: string;
  craigslistUrl?: string;
  x: number;
  y: number;
}

const steps = [
  {
    number: '01',
    title: 'Upload Your Photos',
    description:
      'Upload beautiful photos of your wedding items in seconds.',
  },
  {
    number: '02',
    title: 'Tag & Price Items',
    description:
      "Add descriptions, prices, and categories so buyers can easily discover exactly what they're looking for.",
  },
  {
    number: '03',
    title: 'Buyers Find You',
    description:
      'Your items appear in our curated marketplace, reaching couples actively planning their perfect day.',
  },
];

const blogPosts = [
  {
    id: 1,
    category: 'Selling Tips',
    title: '10 Photos That Make Your Wedding Items Sell Faster',
    excerpt:
      "Great photography is the difference between a listing that lingers and one that sells in days. Here's what buyers respond to.",
    readTime: '4 min read',
    img: 'https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=600&q=80',
  },
  {
    id: 2,
    category: 'Inspiration',
    title: 'How to Price Pre-Loved Wedding Items Fairly',
    excerpt:
      'Pricing is part art, part science. We break down how to value your items so they move quickly — and you feel good about it.',
    readTime: '5 min read',
    img: 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?w=600&q=80',
  },
  {
    id: 3,
    category: 'Sustainability',
    title: 'The Rise of Eco-Conscious Weddings',
    excerpt:
      'More couples are choosing pre-loved decor to reduce waste without sacrificing beauty. See how the trend is reshaping celebrations.',
    readTime: '3 min read',
    img: 'https://images.unsplash.com/photo-1537633552985-df8429e8048b?w=600&q=80',
  },
  {
    id: 4,
    category: 'Florals',
    title: 'What to Do With Your Wedding Flowers After the Big Day',
    excerpt:
      'From pressed keepsakes to selling your dried arrangements, discover creative ways to give your florals a second life.',
    readTime: '3 min read',
    img: 'https://images.unsplash.com/photo-1487530811015-780780169902?w=600&q=80',
  },
];

const testimonials = [
  {
    id: 1,
    initials: 'SA',
    name: 'Sophie & Alex',
    location: 'London',
    quote:
      'We sold £2,400 worth of decorations within three weeks. The listing process was effortless — just upload, tag, and watch the enquiries come in.',
  },
  {
    id: 2,
    initials: 'MJ',
    name: 'Mia & James',
    location: 'Edinburgh',
    quote:
      'I was worried our bespoke items would never find a home. Within days, another couple had fallen in love with our fairy-light canopy. Magical.',
  },
  {
    id: 3,
    initials: 'RL',
    name: 'Rachel & Luke',
    location: 'Bristol',
    quote:
      'We found our entire centrepiece collection here for half the retail price. Every piece was exactly as described. Absolutely recommend.',
  },
  {
    id: 4,
    initials: 'CO',
    name: 'Clara & Oliver',
    location: 'Manchester',
    quote:
      'The photo-first approach really works. Buyers could see the quality immediately, and our gown sold to a lovely couple in Cardiff within a week.',
  },
];

/* ──────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────── */

interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export default function LandingPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingTags, setListingTags] = useState<Record<string, Tag[]>>({});
  const [activeListing, setActiveListing] = useState<Listing | null>(null);
  const [hoveredTagIndex, setHoveredTagIndex] = useState<number | null>(null);
  const modalImgRef = useRef<HTMLImageElement>(null);
  const [modalImgSize, setModalImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    getDocs(
      query(collection(db, 'listings'), orderBy('uploadedAt', 'desc'), limit(8))
    ).then((snap) =>
      setListings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Listing)))
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (listings.length === 0) return;
    Promise.all(
      listings.map(async (listing) => {
        const snap = await getDocs(
          query(collection(db, 'tags'), where('imageId', '==', listing.storagePath))
        );
        return { path: listing.storagePath, tags: snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tag)) };
      })
    ).then((results) => {
      const map: Record<string, Tag[]> = {};
      results.forEach(({ path, tags }) => { map[path] = tags; });
      setListingTags(map);
    }).catch(() => {});
  }, [listings]);

  const openListing = (listing: Listing) => { setActiveListing(listing); setModalImgSize(null); };
  const closeListing = () => { setActiveListing(null); setHoveredTagIndex(null); setModalImgSize(null); };

  const [contactForm, setContactForm] = useState<ContactForm>({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [contactSuccess, setContactSuccess] = useState(false);

  const handleContactChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setContactForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // No backend — just show success state
    setContactSuccess(true);
    setContactForm({ name: '', email: '', subject: '', message: '' });
  };

  return (
    <main className="landing">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__content container">
          <span className="section-label">Wedding Marketplace</span>
          <h1 className="hero__headline">
            Sell Your Wedding,{' '}
            <em>Beautifully.</em>
          </h1>
          <p className="hero__sub">
            Give your cherished pieces a new love story. Connect with couples
            who'll treasure them as much as you did.
          </p>
          <div className="hero__ctas">
            <a href="#gallery" className="btn btn-primary">Browse Items</a>
            <button className="btn btn-outline">Sign In to Sell</button>
          </div>
          <div className="hero__stats">
            <div className="hero__stat">
              <strong>2,400+</strong>
              <span>Items listed</span>
            </div>
            <div className="hero__stat-divider" />
            <div className="hero__stat">
              <strong>£180k</strong>
              <span>Items sold</span>
            </div>
            <div className="hero__stat-divider" />
            <div className="hero__stat">
              <strong>98%</strong>
              <span>Happy sellers</span>
            </div>
          </div>
        </div>
        <div className="hero__image-grid" aria-hidden="true">
          <img src="https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80" alt="" className="hero__img hero__img--tall" />
          <img src="https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=600&q=80" alt="" className="hero__img" />
          <img src="https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=600&q=80" alt="" className="hero__img" />
        </div>
      </section>

      {/* ── Public Gallery ───────────────────────────────────── */}
      {listings.length > 0 && (
        <section className="gallery-section" id="gallery">
          <div className="container">
            <span className="section-label">Browse Items</span>
            <h2 className="section-title">Recently Listed</h2>
            <p className="section-sub">
              Discover beautiful pre-loved wedding pieces from couples across the UK.
            </p>
            <div className="gallery-grid">
              {listings.map((listing) => (
                <div
                  key={listing.id}
                  className="gallery-card"
                  onClick={() => openListing(listing)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && openListing(listing)}
                >
                  <div className="gallery-card__img-wrap">
                    <img src={listing.url} alt="" className="gallery-card__img" loading="lazy" />
                    <div className="gallery-card__overlay">
                      {(listingTags[listing.storagePath] ?? []).length > 0 && (
                        <ul className="gallery-card__tag-list">
                          {listingTags[listing.storagePath].map((tag, i) => (
                            <li key={tag.id} className="gallery-card__tag-item">
                              <span className="gallery-card__tag-num">{i + 1}</span>
                              <span className="gallery-card__tag-desc">{tag.description}</span>
                              {tag.price && <span className="gallery-card__tag-price">{tag.price}</span>}
                              {tag.ebayItemNumber && (
                                <a
                                  href={`https://www.ebay.com/itm/${tag.ebayItemNumber}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="gallery-card__tag-ebay"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  eBay
                                </a>
                              )}
                              {tag.craigslistUrl && (
                                <a
                                  href={tag.craigslistUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="gallery-card__tag-ebay"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Craigslist
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── How It Works ─────────────────────────────────────── */}
      <section className="how-it-works">
        <div className="container">
          <span className="section-label">Simple Process</span>
          <h2 className="section-title">How It Works</h2>
          <p className="section-sub">
            Start selling in minutes. No marketplace fees, no hidden costs.
          </p>
          <div className="steps-grid">
            {steps.map((step) => (
              <div key={step.number} className="step-card">
                <span className="step-card__number">{step.number}</span>
                <h3 className="step-card__title">{step.title}</h3>
                <p className="step-card__desc">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Blog ─────────────────────────────────────────────── */}
      <section className="blog-section" id="journal">
        <div className="container">
          <span className="section-label">The Journal</span>
          <h2 className="section-title">Tips & Inspiration</h2>
          <p className="section-sub">
            From pricing advice to sustainability inspiration — stories for every stage of your wedding journey.
          </p>
          <div className="blog-grid">
            {blogPosts.map((post) => (
              <article key={post.id} className="blog-card">
                <div className="blog-card__img-wrap">
                  <img src={post.img} alt={post.title} className="blog-card__img" loading="lazy" />
                </div>
                <div className="blog-card__body">
                  <span className="blog-card__category">{post.category}</span>
                  <h3 className="blog-card__title">{post.title}</h3>
                  <p className="blog-card__excerpt">{post.excerpt}</p>
                  <span className="blog-card__read-time">{post.readTime}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────── */}
      <section className="testimonials-section" id="stories">
        <div className="container">
          <span className="section-label">Love Stories</span>
          <h2 className="section-title">What Couples Say</h2>
          <div className="testimonials-grid">
            {testimonials.map((t) => (
              <blockquote key={t.id} className="testimonial-card">
                <p className="testimonial-card__quote">"{t.quote}"</p>
                <footer className="testimonial-card__footer">
                  <div className="testimonial-card__avatar">{t.initials}</div>
                  <div>
                    <div className="testimonial-card__name">{t.name}</div>
                    <div className="testimonial-card__location">{t.location}</div>
                  </div>
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact ──────────────────────────────────────────── */}
      <section className="contact-section" id="contact">
        <div className="container">
          <div className="contact-grid">
            <div className="contact-info">
              <span className="section-label">Get in Touch</span>
              <h2 className="section-title">We'd Love to Hear From You</h2>
              <p className="contact-info__text">
                Whether you have a question about selling, need help with a listing, or
                just want to say hello — our small team is here for you.
              </p>
              <ul className="contact-details">
                <li>
                  <span className="contact-details__icon">✉</span>
                  <span>hello@buymywedding.co.uk</span>
                </li>
                <li>
                  <span className="contact-details__icon">📍</span>
                  <span>London, United Kingdom</span>
                </li>
                <li>
                  <span className="contact-details__icon">🕐</span>
                  <span>Mon–Fri, 9am–5pm GMT</span>
                </li>
              </ul>
            </div>
            <div className="contact-form-wrap">
              {contactSuccess ? (
                <div className="contact-success">
                  <div className="contact-success__icon">✓</div>
                  <h3>Message Sent!</h3>
                  <p>Thank you for reaching out. We'll be in touch within one working day.</p>
                  <button
                    className="btn btn-outline"
                    onClick={() => setContactSuccess(false)}
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form className="contact-form" onSubmit={handleContactSubmit}>
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="name" className="form-label">Your name</label>
                      <input
                        id="name"
                        name="name"
                        type="text"
                        className="form-input"
                        placeholder="Jane Smith"
                        value={contactForm.name}
                        onChange={handleContactChange}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="email" className="form-label">Email address</label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        className="form-input"
                        placeholder="jane@example.com"
                        value={contactForm.email}
                        onChange={handleContactChange}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="subject" className="form-label">Subject</label>
                    <select
                      id="subject"
                      name="subject"
                      className="form-input"
                      value={contactForm.subject}
                      onChange={handleContactChange}
                      required
                    >
                      <option value="">Select a topic…</option>
                      <option value="selling">Selling an item</option>
                      <option value="buying">Buying an item</option>
                      <option value="listing">Help with my listing</option>
                      <option value="other">Something else</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="message" className="form-label">Message</label>
                    <textarea
                      id="message"
                      name="message"
                      className="form-input form-textarea"
                      placeholder="Tell us how we can help…"
                      rows={5}
                      value={contactForm.message}
                      onChange={handleContactChange}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Send Message
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Listing Modal ────────────────────────────────────── */}
      {activeListing && (
        <div className="listing-modal-backdrop" onClick={closeListing}>
          <div
            className="listing-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <button className="listing-modal__close" onClick={closeListing} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className="listing-modal__img-wrap">
              <img
                src={activeListing.url}
                alt={activeListing.name}
                className="listing-modal__img"
                ref={modalImgRef}
                onLoad={() => {
                  const img = modalImgRef.current;
                  if (img) setModalImgSize({ w: img.clientWidth, h: img.clientHeight });
                }}
              />
              {modalImgSize && (listingTags[activeListing.storagePath] ?? []).map((tag, i) => {
                const isPct = tag.x <= 1 && tag.y <= 1;
                const left = isPct ? `${tag.x * 100}%` : `${(tag.x / modalImgSize.w) * 100}%`;
                const top = isPct ? `${tag.y * 100}%` : `${(tag.y / modalImgSize.h) * 100}%`;
                return (
                  <span
                    key={tag.id}
                    className={`listing-modal__dot${hoveredTagIndex === i ? ' listing-modal__dot--active' : ''}`}
                    style={{ left, top }}
                  >
                    {i + 1}
                  </span>
                );
              })}
            </div>
            <div className="listing-modal__body">
              {(listingTags[activeListing.storagePath] ?? []).length === 0 ? (
                <p className="listing-modal__hint">No tagged items for this listing yet.</p>
              ) : (
                <ul className="listing-modal__tags">
                  {listingTags[activeListing.storagePath].map((tag, i) => (
                    <li
                      key={tag.id}
                      className={`listing-modal__tag-item${hoveredTagIndex === i ? ' listing-modal__tag-item--active' : ''}`}
                      onMouseEnter={() => setHoveredTagIndex(i)}
                      onMouseLeave={() => setHoveredTagIndex(null)}
                    >
                      <span className="listing-modal__tag-num">{i + 1}</span>
                      <div>
                        <div className="listing-modal__tag-desc">{tag.description}</div>
                        {tag.price && <div className="listing-modal__tag-price">{tag.price}</div>}
                        {tag.ebayItemNumber && (
                          <a
                            href={`https://www.ebay.com/itm/${tag.ebayItemNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="listing-modal__tag-ebay"
                          >
                            View on eBay
                          </a>
                        )}
                        {tag.craigslistUrl && (
                          <a
                            href={tag.craigslistUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="listing-modal__tag-craigslist"
                          >
                            Craigslist
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <div className="footer-brand__logo">Buy My Wedding</div>
              <p className="footer-brand__tagline">
                Giving every wedding piece a second beautiful chapter.
              </p>
            </div>
            <div className="footer-col">
              <h4 className="footer-col__heading">Marketplace</h4>
              <ul className="footer-links">
                <li><a href="#gallery">Browse Items</a></li>
                <li><a href="#how-it-works">How It Works</a></li>
                <li><a href="#journal">The Journal</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4 className="footer-col__heading">Support</h4>
              <ul className="footer-links">
                <li><a href="#contact">Contact Us</a></li>
                <li><a href="#faq">FAQs</a></li>
                <li><a href="#safety">Safe Trading</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4 className="footer-col__heading">Legal</h4>
              <ul className="footer-links">
                <li><a href="#privacy">Privacy Policy</a></li>
                <li><a href="#terms">Terms of Service</a></li>
                <li><a href="#cookies">Cookie Policy</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© {new Date().getFullYear()} Buy My Wedding. All rights reserved.</p>
            <p>Made with love in London.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
