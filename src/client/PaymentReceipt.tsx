import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, CircleDot, Clock3, LockKeyhole, MousePointer2, Split, Wallet } from 'lucide-react';
import type { Auction, LedgerEntry } from '../shared/types';
import './payment-receipt.css';

const money = (cents = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const publisherNames: Record<string, string> = { wavelength: 'Wavelength', wardrobe: 'Thread', cityguide: 'Roam' };

interface PaymentReceiptProps {
  auction: Auction;
  receipt?: LedgerEntry;
  transfer?: LedgerEntry;
  transfers?: LedgerEntry[];
}

/** Presentation follows committed ledger state; animation never advances payment state. */
export function PaymentReceipt({ auction, receipt, transfer, transfers }: PaymentReceiptProps) {
  const reducedMotion = useReducedMotion();
  const placement = auction.placement;
  if (!placement) return null;

  const simulated = (auction.payment_mode ?? 'simulation') === 'simulation';
  const charged = !!receipt;
  const expired = placement.status === 'expired';
  const settled = charged && receipt.status === 'completed';
  const publisher = publisherNames[auction.publisher_id] ?? auction.publisher_id;
  const cpc = receipt?.amount_cents ?? placement.offer.bid_cents;
  const publisherCents = receipt?.publisher_cents ?? Math.floor(cpc * 4 / 5);
  const networkCents = receipt?.network_cents ?? cpc - publisherCents;
  const noTransferDue = charged && !simulated && publisherCents === 0;
  const transferRows = transfers ?? (transfer ? [transfer] : []);
  const paymentState = expired ? 'expired' : settled ? 'settled' : charged ? 'settling' : 'reserved';
  const headline = expired ? 'Reservation released.' : settled ? 'Value, accounted for.' : charged ? 'The click becomes value.' : 'Payment waits for the click.';
  const settlementLabel = !charged ? (simulated ? 'Simulation' : 'Stripe Connect') : simulated ? 'Recorded' : noTransferDue ? 'No transfer due' : settled ? 'Transferred' : 'Transfer pending';
  const transition = { duration: reducedMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] as const };
  const stages = [
    { label: expired ? 'Released' : 'Offer locked', detail: expired ? 'No charge' : '10-minute reservation', icon: LockKeyhole, done: !expired, current: !charged && !expired },
    { label: charged ? 'Click recorded' : 'First click', detail: charged ? 'Charged once' : 'Waiting in the app', icon: MousePointer2, done: charged, current: false },
    { label: 'Revenue split', detail: '80% publisher · 20% network', icon: Split, done: charged, current: false },
    { label: settlementLabel, detail: !charged ? 'After the click' : simulated ? 'No real money moved' : noTransferDue ? 'Publisher share rounds to $0.00' : settled ? 'Sandbox transfer complete' : 'Automatic retry enabled', icon: Wallet, done: settled, current: charged && !settled },
  ];

  return <motion.section
    className={`payment-receipt payment-${paymentState}`}
    initial={reducedMotion ? false : { opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }} transition={transition}
    aria-label="Advertising transaction receipt"
  >
    <div className="payment-heading">
      <div><div className="eyebrow">03 / TRANSACTION RAIL</div><AnimatePresence mode="wait" initial={false}><motion.h3 key={headline} initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}>{headline}</motion.h3></AnimatePresence></div>
      <span className={`payment-mode ${simulated ? 'is-simulation' : 'is-sandbox'}`}>{simulated ? <CircleDot size={12}/> : <LockKeyhole size={12}/>}<span>{simulated ? 'SIMULATED FUNDS' : 'STRIPE SANDBOX'}</span></span>
    </div>

    <ol className="payment-path" aria-label="Payment progress">
      {stages.map((stage, index) => <li key={index} className={`${stage.done ? 'is-done' : ''} ${stage.current ? 'is-current' : ''}`}>
        <div className="payment-path-top"><motion.span className="payment-step-icon" animate={{ backgroundColor: stage.done && index === 3 ? '#e9eddf' : stage.done && index === 1 ? '#ff6d47' : '#fbfaf9', borderColor: stage.done && index === 3 ? '#9baf81' : stage.done && index === 1 ? '#ff6d47' : stage.done ? '#b49b85' : '#e4ddd5', color: stage.done && index === 3 ? '#647748' : stage.done && index === 1 ? '#fffaf4' : stage.done ? '#82624a' : '#b7ab9d' }} transition={transition}>{stage.done && index === 3 ? <Check size={15}/> : <stage.icon size={15}/>}</motion.span>{index < 3 && <span className="payment-connector" aria-hidden="true"><motion.i initial={false} animate={{ scaleX: charged ? 1 : index === 0 && !expired ? 0.18 : 0 }} transition={{ ...transition, delay: reducedMotion ? 0 : index * 0.08 }}/></span>}</div>
        <b>{stage.label}</b><small>{stage.detail}</small>
      </li>)}
    </ol>

    <div className="payment-allocation">
      <div className="payment-source"><span>{charged ? 'ADVERTISER CHARGED' : expired ? 'CPC RELEASED' : 'LOCKED COST PER CLICK'}</span><motion.strong key={`${placement.id}:${charged}`} initial={reducedMotion ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={transition}>{money(cpc)}</motion.strong><small>{placement.offer.brand_name}</small></div>
      <div className="payment-split-mark" aria-hidden="true"><ArrowUpRight size={20}/><ArrowDownLeft size={20}/></div>
      <div className="payment-share publisher-share"><span><i/>{publisher} <em>80%</em></span><strong>{money(publisherCents)}</strong><small>{charged ? 'Publisher earnings' : 'On the first click'}</small></div>
      <div className="payment-share network-share"><span><i/>Accord <em>20%</em></span><strong>{money(networkCents)}</strong><small>{charged ? 'Network gross' : 'On the first click'}</small></div>
    </div>

    <div className="payment-status-line" role="status" aria-live="polite">
      {expired ? <Clock3 size={14}/> : settled ? <Check size={14}/> : charged ? <span className="payment-wait-dot" aria-hidden="true"/> : <MousePointer2 size={14}/>}
      <span>{expired ? 'The offer expired before a billable click. Advertising funds were released.' : !charged ? `Open the winning recommendation in ${publisher} to record the billable click.` : simulated ? 'Simulation recorded. No Stripe transfer or real charge was made.' : noTransferDue ? 'Click charged once. Publisher share rounds to $0.00; no Stripe transfer created.' : settled ? `${money(publisherCents)} transferred to the publisher in Stripe sandbox.` : receipt.error ? 'Click charged once. Publisher transfer is pending and will retry automatically.' : 'Click charged once. Stripe is settling the publisher’s share.'}</span>
      {!simulated && <span className="payment-stripe-wordmark" aria-label="Stripe">stripe</span>}
    </div>

    {charged && <details className="payment-record"><summary>View transaction record <ChevronDown size={13}/></summary><dl><div><dt>Click receipt</dt><dd>{receipt.id}</dd></div><div><dt>Publisher</dt><dd>{auction.publisher_id}</dd></div><div><dt>Recorded</dt><dd>{new Date(receipt.created_at).toLocaleString()}</dd></div><div><dt>Settlement</dt><dd>{simulated ? 'Simulated' : noTransferDue ? 'No transfer due' : receipt.status}</dd></div>{transferRows.map(row => <div key={row.id}><dt>Stripe transfer · {money(row.amount_cents)}</dt><dd>{row.stripe_id ?? row.status}</dd></div>)}{receipt.error && <div><dt>Transfer detail</dt><dd>{receipt.error}</dd></div>}</dl><p>Processing fees are separate. The customer discount is a demo code, not a cashback payment.</p></details>}
  </motion.section>;
}

export default PaymentReceipt;
