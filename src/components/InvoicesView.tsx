import React, { useState } from 'react';
import {
  Receipt,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  DollarSign,
  Printer,
  CreditCard,
  Download,
  ArrowUpRight
} from 'lucide-react';
import { Invoice, Tenant } from '../types.js';
import { formatCurrency, formatDate } from '../lib/utils.js';

interface InvoicesViewProps {
  tenant: Tenant;
  invoices: Invoice[];
  onRecordPayment: (invoiceId: string, amount: number, method: string, reference?: string) => Promise<void>;
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  tenant,
  invoices,
  onRecordPayment,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'paid' | 'unpaid'>('ALL');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<Invoice | null>(null);

  const filteredInvoices = invoices.filter(i => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.customerName.toLowerCase().includes(q) ||
      i.customerEmail.toLowerCase().includes(q);

    const matchesStatus = statusFilter === 'ALL' || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
  const totalCollected = invoices.reduce((s, i) => s + i.paidAmount, 0);
  const totalOutstanding = invoices.reduce((s, i) => s + i.balanceDue, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Invoices & Billing Accounts
            </h1>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {invoices.length} Invoices
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Automated itemized billing, sales tax collection, payment logging, and customer receipts.
          </p>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Total Billed
          </span>
          <span className="text-2xl font-extrabold text-slate-900 mt-1 block">
            {formatCurrency(totalInvoiced, tenant.currency)}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">
            Collected Revenue
          </span>
          <span className="text-2xl font-extrabold text-emerald-600 mt-1 block">
            {formatCurrency(totalCollected, tenant.currency)}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">
            Outstanding Balances
          </span>
          <span className="text-2xl font-extrabold text-amber-600 mt-1 block">
            {formatCurrency(totalOutstanding, tenant.currency)}
          </span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by invoice #, customer name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {(['ALL', 'paid', 'unpaid'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg font-semibold capitalize cursor-pointer transition-colors ${
                statusFilter === tab
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {tab === 'ALL' ? 'All Invoices' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Invoices List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
              <tr>
                <th className="p-4">Invoice #</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Issued Date</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Balance</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-4 font-mono font-bold text-slate-900">
                    {inv.invoiceNumber}
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-800">{inv.customerName}</div>
                    <div className="text-[11px] text-slate-400">{inv.customerEmail}</div>
                  </td>
                  <td className="p-4 text-slate-600 font-medium">
                    {formatDate(inv.issueDate)}
                  </td>
                  <td className="p-4 font-bold text-slate-900">
                    {formatCurrency(inv.total, tenant.currency)}
                  </td>
                  <td className="p-4 font-mono text-slate-600">
                    {inv.balanceDue > 0 ? (
                      <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded">
                        {formatCurrency(inv.balanceDue, tenant.currency)} Due
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-bold">Paid in full</span>
                    )}
                  </td>
                  <td className="p-4">
                    {inv.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        Unpaid
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {inv.status !== 'paid' && (
                        <button
                          onClick={() => {
                            setInvoiceToPay(inv);
                            setIsPaymentModalOpen(true);
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          Record Payment
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedInvoice(inv)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Detail / Print Modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          tenant={tenant}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* Record Payment Modal */}
      {isPaymentModalOpen && invoiceToPay && (
        <RecordPaymentModal
          invoice={invoiceToPay}
          tenant={tenant}
          onClose={() => {
            setIsPaymentModalOpen(false);
            setInvoiceToPay(null);
          }}
          onConfirm={async (amount, method, ref) => {
            await onRecordPayment(invoiceToPay.id, amount, method, ref);
            setIsPaymentModalOpen(false);
            setInvoiceToPay(null);
          }}
        />
      )}
    </div>
  );
};

const InvoiceDetailModal: React.FC<{ invoice: Invoice; tenant: Tenant; onClose: () => void }> = ({
  invoice,
  tenant,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
          <span className="text-xs font-bold text-slate-500">Official Invoice Receipt</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg font-bold">✕</button>
          </div>
        </div>

        <div className="p-8 overflow-y-auto space-y-6 text-xs text-slate-800">
          {/* Company Brand Header */}
          <div className="flex justify-between items-start border-b border-slate-200 pb-6">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{tenant.name}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{tenant.tagline}</p>
              <p className="text-[11px] text-slate-500 mt-1">{tenant.address}</p>
              <p className="text-[11px] text-slate-500">{tenant.phone} • {tenant.email}</p>
            </div>
            <div className="text-right">
              <span className="font-mono text-sm font-extrabold text-slate-900 block">{invoice.invoiceNumber}</span>
              <span className="text-slate-500 text-[11px] block mt-1">Date: {formatDate(invoice.issueDate)}</span>
              <span className="text-slate-500 text-[11px] block">Due: {formatDate(invoice.dueDate)}</span>
              <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                invoice.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {invoice.status}
              </span>
            </div>
          </div>

          {/* Billed To */}
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Billed To</span>
            <div className="font-bold text-slate-900">{invoice.customerName}</div>
            <div className="text-slate-500">{invoice.customerEmail}</div>
          </div>

          {/* Itemized charges */}
          <div>
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 text-slate-400 uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2">Item Description</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-2.5 font-medium text-slate-800">{item.description}</td>
                    <td className="py-2.5 text-center text-slate-600">{item.quantity}</td>
                    <td className="py-2.5 text-right text-slate-600 font-mono">
                      {formatCurrency(item.unitPrice, tenant.currency)}
                    </td>
                    <td className="py-2.5 text-right font-bold text-slate-900 font-mono">
                      {formatCurrency(item.total, tenant.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Calculation */}
          <div className="pt-4 border-t border-slate-200 space-y-1 text-right">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono">{formatCurrency(invoice.subtotal, tenant.currency)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Tax ({tenant.taxRate}%):</span>
              <span className="font-mono">{formatCurrency(invoice.taxAmount, tenant.currency)}</span>
            </div>
            <div className="flex justify-between text-base font-extrabold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total:</span>
              <span className="font-mono text-emerald-600">{formatCurrency(invoice.total, tenant.currency)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Amount Paid:</span>
              <span className="font-mono">{formatCurrency(invoice.paidAmount, tenant.currency)}</span>
            </div>
            {invoice.balanceDue > 0 && (
              <div className="flex justify-between font-bold text-amber-700">
                <span>Balance Due:</span>
                <span className="font-mono">{formatCurrency(invoice.balanceDue, tenant.currency)}</span>
              </div>
            )}
          </div>

          {/* Payment History */}
          {invoice.paymentHistory.length > 0 && (
            <div className="pt-4 border-t border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block mb-2">Payment Receipts</span>
              <div className="space-y-1.5">
                {invoice.paymentHistory.map((p) => (
                  <div key={p.id} className="p-2.5 bg-slate-50 rounded-lg flex items-center justify-between text-[11px]">
                    <div>
                      <span className="font-bold text-slate-800">{p.method}</span>
                      <span className="text-slate-400 ml-2">Ref: {p.reference}</span>
                    </div>
                    <span className="font-mono font-bold text-emerald-600">{formatCurrency(p.amount, tenant.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RecordPaymentModal: React.FC<{
  invoice: Invoice;
  tenant: Tenant;
  onClose: () => void;
  onConfirm: (amount: number, method: string, reference?: string) => Promise<void>;
}> = ({ invoice, tenant, onClose, onConfirm }) => {
  const [amount, setAmount] = useState<number>(invoice.balanceDue);
  const [method, setMethod] = useState('Credit Card (Terminal)');
  const [reference, setReference] = useState(`TRANS-${Math.floor(100000 + Math.random() * 900000)}`);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onConfirm(amount, method, reference);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full border border-slate-200 shadow-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Record Payment for {invoice.invoiceNumber}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Amount to Pay</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              max={invoice.balanceDue}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold font-mono"
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Channel</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            >
              <option value="Credit Card (Terminal)">Credit Card (In-Person)</option>
              <option value="Stripe Online">Stripe Web Payment</option>
              <option value="Cash">Cash Deposit</option>
              <option value="Bank Wire">Bank Wire Transfer</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Transaction Ref #</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded-lg text-xs"
            >
              {loading ? 'Recording...' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
