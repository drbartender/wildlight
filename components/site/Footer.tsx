import Link from 'next/link';
import { Wordmark } from './Wordmark';
import { EmailCaptureStrip } from './EmailCaptureStrip';

export function Footer() {
  return (
    <footer className="wl-footer">
      <div className="top">
        <div>
          <Wordmark size={24} />
          <p className="tag">
            A small, considered selection of fine-art photography by Dan Raby.
            Added sparingly. Printed to order.
          </p>
          <div className="capture">
            <EmailCaptureStrip
              source="footer"
              eyebrow="A quiet letter"
              headline="The next chapter, in your inbox."
              body="New work, the occasional studio note, and first look at limited editions before they list. No more than once a month."
            />
          </div>
        </div>
        <div>
          <div className="h">Shop</div>
          <Link className="link" href="/shop/collections">
            Collections
          </Link>
          <Link className="link" href="/shop">
            Index of plates
          </Link>
          <Link className="link" href="/contact?reason=corporate-gift">
            Gift a print
          </Link>
        </div>
        <div>
          <div className="h">Studio</div>
          <Link className="link" href="/about">
            About Dan
          </Link>
          <Link className="link" href="/journal">
            Journal
          </Link>
          <Link className="link" href="/services/portraits">
            Portraits
          </Link>
          <Link className="link" href="/contact?reason=commission">
            Commissions
          </Link>
          <Link className="link" href="/contact?reason=license">
            Licensing
          </Link>
          <Link className="link" href="/contact">
            Contact
          </Link>
        </div>
        <div>
          <div className="h">Care</div>
          <Link className="link" href="/legal/shipping-returns">
            Shipping &amp; returns
          </Link>
          <Link className="link" href="/legal/terms">
            Terms
          </Link>
          <Link className="link" href="/legal/privacy">
            Privacy
          </Link>
        </div>
      </div>
      <div className="fine">
        <span>
          © {new Date().getFullYear()} Wildlight Imagery · Aurora, Colorado
        </span>
        <span>Archival · Printed to order · Shipped worldwide</span>
      </div>
    </footer>
  );
}
