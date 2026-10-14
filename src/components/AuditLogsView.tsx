import React, { useState } from 'react';
import {
  ScrollText,
  Search,
  Shield,
  Filter,
  User,
  Calendar,
  Terminal,
  Activity,
  Car,
  FileText,
  CreditCard,
  Wrench,
  Inbox
} from 'lucide-react';
import { AuditLog, Tenant } from '../types.js';
import { formatDate } from '../lib/utils.js';

interface AuditLogsViewProps {
  tenant: Tenant;
  auditLogs: AuditLog[];
  onRefresh?: () => Promise<void>;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  tenant,
  auditLogs,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filteredLogs = auditLogs.filter(log => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      log.userName.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.entityType.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q) ||
      (log.ipAddress && log.ipAddress.includes(q));

    const matchesAction = actionFilter === 'all' || log.entityType === actionFilter;
    return matchesSearch && matchesAction;
  });

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'rental':
        return <Calendar className="w-3.5 h-3.5 text-blue-600" />;
      case 'vehicle':
        return <Car className="w-3.5 h-3.5 text-amber-600" />;
      case 'customer':
        return <User className="w-3.5 h-3.5 text-emerald-600" />;
      case 'invoice':
        return <CreditCard className="w-3.5 h-3.5 text-purple-600" />;
      case 'maintenance':
        return <Wrench className="w-3.5 h-3.5 text-rose-600" />;
      case 'enquiry':
        return <Inbox className="w-3.5 h-3.5 text-teal-600" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  const getActionBadge = (action: string) => {
    let color = 'bg-slate-100 text-slate-800';
    if (action.includes('create')) color = 'bg-emerald-100 text-emerald-800';
    else if (action.includes('update')) color = 'bg-blue-100 text-blue-800';
    else if (action.includes('delete')) color = 'bg-rose-100 text-rose-800';
    else if (action.includes('checkin') || action.includes('checkout')) color = 'bg-purple-100 text-purple-800';
    else if (action.includes('payment')) color = 'bg-teal-100 text-teal-800';

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold ${color}`}>
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              System Audit Trail & Security Logs
            </h1>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {auditLogs.length} Events Logged
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Immutable tracking of sensitive tenant mutations, vehicle check-ins, payments, and staff actions.
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh Logs'}</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by user, action, IP, or details..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {['all', 'rental', 'vehicle', 'customer', 'invoice', 'maintenance', 'enquiry'].map(cat => (
            <button
              key={cat}
              onClick={() => setActionFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                actionFilter === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center">
            <ScrollText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No audit events found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No audit logs match the current search filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Initiated By</th>
                  <th className="py-3 px-4">Event Details</th>
                  <th className="py-3 px-4 text-right">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatDate(log.timestamp)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 capitalize">
                        {getEntityIcon(log.entityType)}
                        {log.entityType}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900">{log.userName}</span>
                        {log.userRole && (
                          <span className="text-[10px] text-slate-400 capitalize font-medium">{log.userRole}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 max-w-md">
                      <p className="line-clamp-2">{log.details}</p>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {log.ipAddress || 'internal'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
