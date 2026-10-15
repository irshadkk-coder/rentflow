import React, { useState, useMemo } from 'react';
import {
  MapPin,
  Navigation,
  ExternalLink,
  Search,
  AlertCircle,
  CheckCircle2,
  X,
  Compass,
  Phone,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { PublicBranch } from '../types.js';
import { parseLatitude, parseLongitude } from '../lib/coordinates.js';

interface NearbyBranchesModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: PublicBranch[];
  selectedBranchName: string;
  onSelectBranch: (branchName: string) => void;
}

// Haversine formula for straight-line distance in kilometers
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export const NearbyBranchesModal: React.FC<NearbyBranchesModalProps> = ({
  isOpen,
  onClose,
  branches,
  selectedBranchName,
  onSelectBranch,
}) => {
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Compute distances if coordinates are available, and filter by query
  const branchesWithDistance = useMemo(() => {
    return branches.map((b) => {
      let distanceKm: number | undefined = undefined;
      if (userCoords) {
        const bLat = parseLatitude(b.latitude);
        const bLng = parseLongitude(b.longitude);
        if (bLat !== null && bLng !== null) {
          distanceKm = calculateHaversineDistanceKm(
            userCoords.latitude,
            userCoords.longitude,
            bLat,
            bLng
          );
        }
      }
      return {
        ...b,
        distanceKm,
      };
    });
  }, [branches, userCoords]);

  const filteredAndSortedBranches = useMemo(() => {
    let list = [...branchesWithDistance];

    // Filter by search query (city, pincode, address, name)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.city.toLowerCase().includes(q) ||
          b.pincode.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q) ||
          b.address.toLowerCase().includes(q)
      );
    }

    // Sort by distance if userCoords available, else alphabetically by name
    if (userCoords) {
      list.sort((a, b) => (a.distanceKm ?? 999999) - (b.distanceKm ?? 999999));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [branchesWithDistance, searchQuery, userCoords]);

  if (!isOpen) return null;

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser. Please search by city or pincode below.');
      return;
    }

    setGeoLoading(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError('Location permission was denied. You can search by city or pincode below.');
        } else if (err.code === err.TIMEOUT) {
          setGeoError('Location request timed out. Please search by city or pincode below.');
        } else {
          setGeoError('Unable to detect your location. Please search by city or pincode below.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Find Nearby Rental Branches</h3>
              <p className="text-xs text-slate-500">
                Locate stations nearest to you for pickup and return
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action & Search Bar */}
        <div className="p-5 border-b border-slate-100 space-y-3 bg-white">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Geolocation Button */}
            <button
              id="detect-location-btn"
              type="button"
              onClick={handleDetectLocation}
              disabled={geoLoading}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer flex-shrink-0"
            >
              {geoLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Locating GPS...</span>
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4" />
                  <span>Use My Location</span>
                </>
              )}
            </button>

            {/* City/Pincode Fallback Search */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="branch-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Or search by city, pincode, or address..."
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 transition-all focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Location status badge or error banner */}
          {userCoords && !geoLoading && (
            <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200/60 rounded-xl text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>
                Sorted by proximity to your current location (Haversine straight-line distance).
              </span>
            </div>
          )}

          {geoError && (
            <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200/60 rounded-xl text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span>{geoError}</span>
            </div>
          )}
        </div>

        {/* Branch List */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1 bg-slate-50/50">
          {filteredAndSortedBranches.length === 0 ? (
            <div className="py-12 text-center bg-white rounded-xl border border-slate-200 p-6">
              <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700">No branches match your search.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Try searching with a different city, pincode, or clearing your search.
              </p>
            </div>
          ) : (
            filteredAndSortedBranches.map((branch) => {
              const isSelected = selectedBranchName.toLowerCase() === branch.name.toLowerCase();
              const bLat = parseLatitude(branch.latitude);
              const bLng = parseLongitude(branch.longitude);
              const directionsUrl =
                bLat !== null && bLng !== null
                  ? `https://www.google.com/maps/dir/?api=1&destination=${bLat},${bLng}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.name}, ${branch.address}, ${branch.city}`)}`;

              return (
                <div
                  key={branch.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-emerald-50/60 border-emerald-300 shadow-xs ring-1 ring-emerald-400'
                      : 'bg-white hover:bg-slate-50 border-slate-200 shadow-2xs'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">
                          {branch.name}
                        </span>
                        {branch.distanceKm !== undefined && (
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Navigation className="w-3 h-3" />
                            {branch.distanceKm} km away
                          </span>
                        )}
                        {isSelected && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white px-2 py-0.5 rounded-md">
                            Selected Hub
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span>
                          {branch.address}, {branch.city} - {branch.pincode}
                        </span>
                      </p>

                      {branch.phone && (
                        <p className="text-xs text-slate-500 flex items-center gap-1.5 pt-0.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span>{branch.phone}</span>
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <a
                        href={directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Open directions in Google Maps"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                        <span>Directions</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => {
                          onSelectBranch(branch.name);
                          onClose();
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                        }`}
                      >
                        <span>{isSelected ? 'Active Selection' : 'Select Branch'}</span>
                        {!isSelected && <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-white border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 px-5">
          <span>{filteredAndSortedBranches.length} active station hubs available</span>
          <button
            onClick={onClose}
            className="text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
