import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Shield,
  Mail,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  MoreVertical,
  Building2,
  Check,
  X,
  UserCheck,
  UserX
} from 'lucide-react';
import { TeamMember, TeamInvitation, UserRole, Tenant } from '../types.js';
import { api } from '../lib/api.js';

interface TeamManagementViewProps {
  tenant: Tenant;
  currentUser?: any;
  showToast: (msg: string) => void;
  showErrorToast: (msg: string) => void;
}

export const TeamManagementView: React.FC<TeamManagementViewProps> = ({
  tenant,
  currentUser,
  showToast,
  showErrorToast,
}) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'owner' | 'manager' | 'staff'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'pending'>('all');

  // Invite Modal
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff');
  const [inviteBranch, setInviteBranch] = useState(tenant.locations?.[0] || '');
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Action Loading states
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

  const isOwner = currentUser?.role === 'owner';

  const loadTeamData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await api.getTeamMembers();
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to fetch team members.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTeamData();
  }, [tenant.id]);

  // Metrics
  const totalTeamMembers = members.length;
  const activeMembersCount = members.filter(m => m.isActive).length;
  const pendingInvitationsCount = invitations.filter(i => i.status === 'pending').length;

  // Filtered members & invitations
  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.email.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRole = roleFilter === 'all' || m.role === roleFilter;

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && m.isActive) ||
        (statusFilter === 'inactive' && !m.isActive);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [members, searchTerm, roleFilter, statusFilter]);

  const filteredInvitations = useMemo(() => {
    if (statusFilter === 'active' || statusFilter === 'inactive') {
      return [];
    }
    return invitations.filter(inv => {
      const matchesSearch =
        inv.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.email.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRole = roleFilter === 'all' || inv.role === roleFilter;

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'pending' && inv.status === 'pending');

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [invitations, searchTerm, roleFilter, statusFilter]);

  // Handle Send Invite
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);

    if (!inviteName.trim()) {
      setInviteError('Please provide employee full name.');
      return;
    }
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setInviteError('Please provide a valid work email address.');
      return;
    }

    setIsSubmittingInvite(true);
    try {
      const res = await api.createTeamInvitation({
        name: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        branch: inviteBranch.trim() || undefined
      });
      showToast(res.message || `Invitation successfully sent to ${inviteEmail}.`);
      setIsInviteModalOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('staff');
      await loadTeamData(true);
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send team invitation.');
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  // Handle Resend Invite
  const handleResendInvite = async (invitation: TeamInvitation) => {
    setActionLoadingId(invitation.id);
    try {
      const res = await api.resendTeamInvitation(invitation.id);
      showToast(res.message || `Invitation re-sent to ${invitation.email}.`);
      await loadTeamData(true);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to resend invitation.');
    } finally {
      setActionLoadingId(null);
      setActiveDropdownId(null);
    }
  };

  // Handle Cancel Invite
  const handleCancelInvite = async (invitation: TeamInvitation) => {
    if (!confirm(`Are you sure you want to cancel the invitation for ${invitation.email}?`)) {
      return;
    }
    setActionLoadingId(invitation.id);
    try {
      const res = await api.cancelTeamInvitation(invitation.id);
      showToast(res.message || 'Invitation cancelled successfully.');
      await loadTeamData(true);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to cancel invitation.');
    } finally {
      setActionLoadingId(null);
      setActiveDropdownId(null);
    }
  };

  // Handle Role Change
  const handleChangeRole = async (member: TeamMember, newRole: 'manager' | 'staff') => {
    if (member.id === currentUser?.id) {
      showErrorToast('You cannot change your own role.');
      return;
    }
    setActionLoadingId(member.id);
    try {
      const res = await api.updateTeamMemberRole(member.id, newRole);
      showToast(res.message || `Role updated to ${newRole.toUpperCase()}.`);
      await loadTeamData(true);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to update member role.');
    } finally {
      setActionLoadingId(null);
      setActiveDropdownId(null);
    }
  };

  // Handle Deactivate Member
  const handleDeactivateMember = async (member: TeamMember) => {
    if (member.id === currentUser?.id) {
      showErrorToast('You cannot deactivate your own account.');
      return;
    }
    if (!confirm(`Are you sure you want to deactivate ${member.name} (${member.email})? Their active sessions will be terminated immediately.`)) {
      return;
    }
    setActionLoadingId(member.id);
    try {
      const res = await api.deactivateTeamMember(member.id);
      showToast(res.message || 'Team member deactivated.');
      await loadTeamData(true);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to deactivate team member.');
    } finally {
      setActionLoadingId(null);
      setActiveDropdownId(null);
    }
  };

  // Handle Reactivate Member
  const handleReactivateMember = async (member: TeamMember) => {
    setActionLoadingId(member.id);
    try {
      const res = await api.reactivateTeamMember(member.id);
      showToast(res.message || 'Team member reactivated.');
      await loadTeamData(true);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to reactivate team member.');
    } finally {
      setActionLoadingId(null);
      setActiveDropdownId(null);
    }
  };

  if (!isOwner) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200/80 text-center max-w-xl mx-auto my-12 shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200">
          <Shield className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900 mb-1">Access Restricted</h2>
        <p className="text-xs text-slate-500">
          Team Management and staff invitations require the Business Owner role. Please contact your organization owner for access permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Team Management</h1>
            <span className="text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
              RBAC
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage your team and their access to RentFlow.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadTeamData(true)}
            disabled={refreshing}
            className="p-2.5 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            title="Refresh team list"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            id="invite-team-member-btn"
            onClick={() => setIsInviteModalOpen(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invite Team Member</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 flex-shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Total Team Members</div>
            <div className="text-2xl font-black text-slate-900">{totalTeamMembers}</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 flex-shrink-0">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Active Members</div>
            <div className="text-2xl font-black text-emerald-700">{activeMembersCount}</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 flex-shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Pending Invitations</div>
            <div className="text-2xl font-black text-amber-700">{pendingInvitationsCount}</div>
          </div>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Role Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs w-1/2 sm:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as any)}
              className="bg-transparent text-slate-700 font-semibold focus:outline-none text-xs cursor-pointer"
            >
              <option value="all">All Roles</option>
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs w-1/2 sm:w-auto">
            <Shield className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-transparent text-slate-700 font-semibold focus:outline-none text-xs cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Members</option>
              <option value="inactive">Deactivated</option>
              <option value="pending">Pending Invites</option>
            </select>
          </div>
        </div>
      </div>

      {/* Team Members & Invitations Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 font-medium">Loading team members...</p>
          </div>
        ) : filteredMembers.length === 0 && filteredInvitations.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Users className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No team members match your criteria</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Try adjusting your search terms or filters, or invite new team members to collaborate on RentFlow.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/75 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Member Name</th>
                  <th className="py-3 px-4">Work Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4">Date Joined</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {/* Active / Registered Members */}
                {filteredMembers.map((member) => {
                  const isCurrent = member.id === currentUser?.id;
                  const isMemberOwner = member.role === 'owner';
                  const isActionLoading = actionLoadingId === member.id;

                  return (
                    <tr key={`member-${member.id}`} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs">
                            {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{member.name}</span>
                              {isCurrent && (
                                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                                  You
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600 font-medium font-mono text-[11px]">
                        {member.email}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          member.role === 'owner'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : member.role === 'manager'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          <Shield className="w-3 h-3" />
                          <span>{member.role}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        {member.branch ? (
                          <span className="inline-flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-slate-700 font-medium">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            <span>{member.branch}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">All Branches</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {member.isActive ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold text-[10px] border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full font-bold text-[10px] border border-rose-200">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            <span>Deactivated</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-slate-500 font-medium">
                        {member.createdAt ? new Date(member.createdAt).toLocaleDateString() : '—'}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        {isActionLoading ? (
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin ml-auto" />
                        ) : isCurrent ? (
                          <span className="text-[11px] text-slate-400 italic">Self</span>
                        ) : isMemberOwner ? (
                          <span className="text-[11px] text-slate-400 italic">Owner</span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            {/* Toggle Role Button */}
                            <button
                              type="button"
                              onClick={() => handleChangeRole(member, member.role === 'manager' ? 'staff' : 'manager')}
                              className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                              title={`Switch to ${member.role === 'manager' ? 'STAFF' : 'MANAGER'}`}
                            >
                              Make {member.role === 'manager' ? 'Staff' : 'Manager'}
                            </button>

                            {/* Deactivate / Reactivate Button */}
                            {member.isActive ? (
                              <button
                                type="button"
                                onClick={() => handleDeactivateMember(member)}
                                className="px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                                title="Deactivate user access and terminate sessions"
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleReactivateMember(member)}
                                className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                                title="Restore user access"
                              >
                                Reactivate
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* Pending Invitations */}
                {filteredInvitations.map((invitation) => {
                  const isActionLoading = actionLoadingId === invitation.id;
                  const isPending = invitation.status === 'pending';
                  const isExpired = invitation.status === 'expired' || new Date(invitation.expiresAt) < new Date();

                  return (
                    <tr key={`inv-${invitation.id}`} className="bg-amber-50/20 hover:bg-amber-50/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-100/70 border border-amber-200 text-amber-800 font-bold flex items-center justify-center text-xs">
                            <Mail className="w-4 h-4 text-amber-700" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-900">{invitation.name}</div>
                            <div className="text-[10px] text-amber-800">Invited by {invitation.invitedByName || 'Owner'}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600 font-medium font-mono text-[11px]">
                        {invitation.email}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          invitation.role === 'manager'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          <Shield className="w-3 h-3" />
                          <span>{invitation.role}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        {invitation.branch ? (
                          <span className="inline-flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-slate-700 font-medium">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            <span>{invitation.branch}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">All Branches</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {isPending && !isExpired ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-bold text-[10px] border border-amber-200">
                            <Clock className="w-3 h-3 text-amber-600" />
                            <span>Pending (24h)</span>
                          </span>
                        ) : isExpired ? (
                          <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full font-bold text-[10px] border border-slate-200">
                            <AlertCircle className="w-3 h-3 text-slate-500" />
                            <span>Expired</span>
                          </span>
                        ) : invitation.status === 'cancelled' ? (
                          <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-bold text-[10px] border border-slate-200">
                            <XCircle className="w-3 h-3 text-slate-400" />
                            <span>Cancelled</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold text-[10px] border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Accepted</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-slate-500 font-medium">
                        {new Date(invitation.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        {isActionLoading ? (
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin ml-auto" />
                        ) : invitation.status === 'accepted' ? (
                          <span className="text-[11px] text-emerald-600 font-semibold">Joined</span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleResendInvite(invitation)}
                              className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                              title="Resend invitation email with refreshed 24h token"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Resend</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCancelInvite(invitation)}
                              className="px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                              title="Cancel invitation"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Team Member Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Invite Team Member</h3>
                  <p className="text-[11px] text-slate-500">Send an invitation to join your RentFlow workspace</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inviteError && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <span>{inviteError}</span>
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Morgan"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Work Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="alex.morgan@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Role Assignment</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'manager' | 'staff')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="staff">Staff (Frontdesk)</option>
                    <option value="manager">Manager (Fleet & Ops)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Branch (Optional)</label>
                  <select
                    value={inviteBranch}
                    onChange={(e) => setInviteBranch(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="">All Branches</option>
                    {(tenant.locations || []).map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <div className="font-bold text-slate-700">Security & Invitation Policy:</div>
                <ul className="list-disc pl-4 space-y-0.5 text-[10px] text-slate-500">
                  <li>Owner cannot create another Owner through team invitations.</li>
                  <li>An invitation link expiring in 24 hours will be emailed via Brevo.</li>
                  <li>The invitee sets their password upon accepting the invitation.</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingInvite}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmittingInvite ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Sending Invitation...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Send Invitation</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
