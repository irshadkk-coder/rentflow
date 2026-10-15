import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Search,
  MapPin,
  X,
  Check,
  Loader2,
  Navigation,
  AlertCircle,
  HelpCircle,
  Compass
} from 'lucide-react';

// Configure crisp custom Leaflet emerald marker icon
const branchPinIcon = L.divIcon({
  className: 'rentflow-map-pin',
  html: `<div style="
    position: relative;
    width: 34px;
    height: 34px;
    background: #059669;
    border: 2.5px solid #ffffff;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 6px 14px -2px rgba(5, 150, 105, 0.4), 0 3px 6px rgba(0,0,0,0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
  ">
    <div style="
      width: 10px;
      height: 10px;
      background: #ffffff;
      border-radius: 50%;
      transform: rotate(45deg);
    "></div>
  </div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -34]
});

interface NominatimPlace {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

export interface SelectedLocationData {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  pincode?: string;
}

interface MapLocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (location: SelectedLocationData) => void;
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
  branchName?: string;
}

// Helper component to smoothly center map when position changes
function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 1 });
  }, [center, map]);
  return null;
}

// Helper component to fix tile sizing inside newly mounted modal
function MapInvalidator() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

// Map click listener component
function MapEventsHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export const MapLocationPickerModal: React.FC<MapLocationPickerModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialLat,
  initialLng,
  initialAddress,
  branchName
}) => {
  // Fallback default coordinates: San Francisco center if none provided
  const defaultCenter: [number, number] = [37.7749, -122.4194];

  const hasValidInitial =
    typeof initialLat === 'number' &&
    !isNaN(initialLat) &&
    initialLat >= -90 &&
    initialLat <= 90 &&
    typeof initialLng === 'number' &&
    !isNaN(initialLng) &&
    initialLng >= -180 &&
    initialLng <= 180 &&
    (initialLat !== 0 || initialLng !== 0);

  const [selectedCoords, setSelectedCoords] = useState<[number, number]>(
    hasValidInitial ? [initialLat!, initialLng!] : defaultCenter
  );
  const [mapCenter, setMapCenter] = useState<[number, number]>(
    hasValidInitial ? [initialLat!, initialLng!] : defaultCenter
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimPlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [detectedAddress, setDetectedAddress] = useState<{
    display?: string;
    city?: string;
    pincode?: string;
    street?: string;
  } | null>(null);

  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Sync state whenever modal opens or initial coords change
  useEffect(() => {
    if (isOpen) {
      if (hasValidInitial) {
        setSelectedCoords([initialLat!, initialLng!]);
        setMapCenter([initialLat!, initialLng!]);
      } else {
        setSelectedCoords(defaultCenter);
        setMapCenter(defaultCenter);
      }
      setSearchQuery(initialAddress || '');
      setSearchResults([]);
      setSearchError(null);
      setDetectedAddress(null);
    }
  }, [isOpen, initialLat, initialLng, initialAddress]);

  // Reverse geocode when marker is placed/moved (throttled/on demand)
  const reverseGeocode = useCallback(async (lat: number, lon: number) => {
    try {
      setIsReverseGeocoding(true);
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'en'
        }
      });
      if (res.ok) {
        const data: NominatimPlace = await res.json();
        if (data && data.address) {
          const city =
            data.address.city ||
            data.address.town ||
            data.address.village ||
            data.address.suburb ||
            data.address.county ||
            '';
          const street = [data.address.house_number, data.address.road].filter(Boolean).join(' ');
          setDetectedAddress({
            display: data.display_name,
            city,
            pincode: data.address.postcode || '',
            street: street || data.display_name.split(',')[0]
          });
        }
      }
    } catch {
      // Non-critical reverse geocoding failure; coordinates remain valid
    } finally {
      setIsReverseGeocoding(false);
    }
  }, []);

  const handleMapClick = (lat: number, lng: number) => {
    const newCoords: [number, number] = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
    setSelectedCoords(newCoords);
    reverseGeocode(newCoords[0], newCoords[1]);
  };

  const handleMarkerDragEnd = () => {
    const marker = markerRef.current;
    if (marker) {
      const pos = marker.getLatLng();
      const newCoords: [number, number] = [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))];
      setSelectedCoords(newCoords);
      reverseGeocode(newCoords[0], newCoords[1]);
    }
  };

  // Perform geocoding search using Nominatim
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query || query.length < 2) return;

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    setIsSearching(true);
    setSearchError(null);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query
      )}&limit=5&addressdetails=1`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept-Language': 'en'
        }
      });

      if (!res.ok) {
        throw new Error('Geocoding service unavailable. Please enter coordinates manually.');
      }

      const data: NominatimPlace[] = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setSearchError('No places found matching your query. Try a city, street, or landmark.');
        setSearchResults([]);
      } else {
        setSearchResults(data);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setSearchError('Failed to search location. You can click on the map directly.');
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (place: NominatimPlace) => {
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    if (!isNaN(lat) && !isNaN(lon)) {
      const newCoords: [number, number] = [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
      setSelectedCoords(newCoords);
      setMapCenter(newCoords);
      setSearchResults([]);

      const city =
        place.address?.city ||
        place.address?.town ||
        place.address?.village ||
        place.address?.suburb ||
        place.address?.county ||
        '';
      const street = [place.address?.house_number, place.address?.road].filter(Boolean).join(' ');

      setDetectedAddress({
        display: place.display_name,
        city,
        pincode: place.address?.postcode || '',
        street: street || place.display_name.split(',')[0]
      });
    }
  };

  const handleConfirm = () => {
    onConfirm({
      latitude: selectedCoords[0],
      longitude: selectedCoords[1],
      address: detectedAddress?.street,
      city: detectedAddress?.city,
      pincode: detectedAddress?.pincode
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200/80 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>Select Branch Location on Map</span>
                {branchName && (
                  <span className="text-slate-400 font-normal truncate max-w-[200px]">
                    — {branchName}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-500">
                Click anywhere on the map, drag the green pin, or search to position the branch.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            aria-label="Close map picker"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-100 bg-white relative z-10">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search city, address, or landmark (e.g. SFO Airport, Embarcadero San Francisco)..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-hidden transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Search</span>
                </>
              )}
            </button>
          </form>

          {/* Search Error */}
          {searchError && (
            <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Autocomplete / Search Results dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden max-h-56 overflow-y-auto">
              <div className="p-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 bg-slate-50 border-b border-slate-100">
                Found Locations (select one)
              </div>
              {searchResults.map((place) => (
                <button
                  key={place.place_id}
                  type="button"
                  onClick={() => handleSelectSearchResult(place)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50/80 border-b border-slate-100 last:border-0 transition-colors flex items-start gap-2 cursor-pointer group"
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                  <span className="text-slate-700 group-hover:text-emerald-900 line-clamp-2">
                    {place.display_name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Map Container */}
        <div className="relative flex-1 min-h-[340px] sm:min-h-[400px] w-full bg-slate-100">
          <MapContainer
            center={mapCenter}
            zoom={13}
            scrollWheelZoom={true}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
            <MapInvalidator />
            <MapRecenter center={mapCenter} />
            <MapEventsHandler onMapClick={handleMapClick} />

            <Marker
              position={selectedCoords}
              icon={branchPinIcon}
              draggable={true}
              eventHandlers={{
                dragend: handleMarkerDragEnd
              }}
              ref={markerRef}
            />
          </MapContainer>

          {/* Instruction overlay pill */}
          <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-xs px-2.5 py-1.5 rounded-lg border border-slate-200/80 shadow-xs pointer-events-none text-[11px] text-slate-700 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
            <span>Click map or drag marker to adjust location</span>
          </div>

          {/* OpenStreetMap attribution badge */}
          <div className="absolute bottom-1 right-1 z-[1000] bg-white/80 backdrop-blur-xs px-2 py-0.5 rounded text-[9px] text-slate-500 pointer-events-none">
            Powered by OpenStreetMap &amp; Nominatim
          </div>
        </div>

        {/* Footer / Selected Coordinate Details */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">Selected Coordinates:</span>
              <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold">
                {selectedCoords[0].toFixed(6)}, {selectedCoords[1].toFixed(6)}
              </span>
              {isReverseGeocoding && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
              )}
            </div>

            {detectedAddress?.display ? (
              <p className="text-[11px] text-slate-500 line-clamp-1 max-w-lg">
                <span className="font-semibold text-slate-600">Detected:</span>{' '}
                {detectedAddress.display}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">
                Coordinates will automatically populate the branch form.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              id="confirm-map-location-btn"
              onClick={handleConfirm}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Confirm Location</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
