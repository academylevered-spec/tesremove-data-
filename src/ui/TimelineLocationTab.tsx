'use client';

import { useState } from 'react';
import { AlertTriangle, Clock, MapPin } from 'lucide-react';
import type { Locale, LocationInfo, TimelineEntry } from '../engine/types';
import type { Translations } from '../i18n/translations';
import LeafletMap from './LeafletMap';

interface TimelineLocationTabProps {
  timeline: TimelineEntry[];
  location?: LocationInfo;
  locale: Locale;
  t: Translations;
}

export default function TimelineLocationTab({ timeline, location, locale, t }: TimelineLocationTabProps) {
  const [mapLoaded, setMapLoaded] = useState(false);

  return (
    <div className="space-y-6">
      {/* Location Panel (Click-to-load Map) */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {locale === 'id' ? 'Lokasi Geografis (GPS)' : 'Geographic Location (GPS)'}
          </h3>
        </div>

        {!location ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.noLocation}</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Desimal (Lat, Lon)' : 'Decimal (Lat, Lon)'}
                </dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {location.lat}, {location.lon}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">DMS</dt>
                <dd className="font-mono text-xs text-slate-900 dark:text-slate-100">
                  {location.latDms} · {location.lonDms}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">{locale === 'id' ? 'Ketinggian' : 'Altitude'}</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {location.alt !== undefined ? `${location.alt} m` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">{locale === 'id' ? 'Arah / Sumber' : 'Direction / Source'}</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {location.direction !== undefined ? `${location.direction}° · ` : ''}
                  {location.source}
                </dd>
              </div>
            </dl>

            {!mapLoaded ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">{t.mapPrivacyNotice}</p>
                <button
                  type="button"
                  onClick={() => setMapLoaded(true)}
                  className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
                >
                  {t.showOnMap}
                </button>
              </div>
            ) : (
              <LeafletMap lat={location.lat} lon={location.lon} label={`${location.lat}, ${location.lon}`} />
            )}
          </div>
        )}
      </section>

      {/* Timestamp Timeline */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <Clock className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {locale === 'id' ? 'Linimasa Semua Timestamp' : 'All Timestamps Timeline'}
          </h3>
        </div>

        {timeline.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            {locale === 'id' ? 'Tidak ada field timestamp yang tercatat pada file ini.' : 'No timestamp fields were recorded in this file.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Field</th>
                  <th className="py-2.5 px-4">{locale === 'id' ? 'Nilai Tercatat' : 'Recorded Value'}</th>
                  <th className="py-2.5 px-4">UTC (ISO 8601)</th>
                  <th className="py-2.5 px-4">{locale === 'id' ? 'Catatan / Anomali' : 'Note / Anomaly'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {timeline.map((entry, idx) => (
                  <tr key={idx} className={entry.anomaly ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">{entry.label}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200">{entry.value}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {entry.utc ?? (entry.isZeroed ? t.zeroedLabel : '—')}
                    </td>
                    <td className="py-2.5 px-4">
                      {entry.anomaly ? (
                        <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          {entry.anomaly}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
