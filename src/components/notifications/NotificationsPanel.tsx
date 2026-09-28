/**
 * Notifications Panel Component
 *
 * Displays user notifications.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SparklesIcon,
  CalendarDaysIcon,
  ArrowTrendingUpIcon,
  ArrowPathIcon,
  ChartBarIcon,
  BellIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import { getUserNotifications, markNotificationAsRead } from '../../services/notifications';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { uiLocaleTag } from '../../common/uiLocale';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const NOTIFICATION_ICON: Record<string, { Icon: IconType; tone: string }> = {
  proposal:           { Icon: SparklesIcon,       tone: 'text-violet-300 bg-violet-500/10' },
  scheduled_content:  { Icon: CalendarDaysIcon,   tone: 'text-indigo-300 bg-indigo-500/10' },
  ranking_change:     { Icon: ArrowTrendingUpIcon, tone: 'text-emerald-300 bg-emerald-500/10' },
  content_update:     { Icon: ArrowPathIcon,       tone: 'text-violet-300 bg-violet-500/10' },
  weekly_report:      { Icon: ChartBarIcon,        tone: 'text-white/70 bg-white/[0.06]' },
};

export const NotificationsPanel = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', user?.id, filter],
    queryFn: () => getUserNotifications(user?.id || ''),
    enabled: !!user,
    select: (data) => {
      if (filter === 'unread') {
        return data.filter((n) => !n.read);
      }
      return data;
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (isLoading) {
    return <LoadingSpinner text="Caricamento notifiche..." />;
  }

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('notifications.title')}</h3>
        <div className="flex gap-2">
          <Button
            variant={filter === 'all' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            {t('notifications.filterAll')}
          </Button>
          <Button
            variant={filter === 'unread' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter('unread')}
          >
            {t('notifications.filterUnread')} {unreadCount > 0 && <Badge variant="error" size="sm">{unreadCount}</Badge>}
          </Button>
        </div>
      </div>

      {notifications && notifications.length > 0 ? (
        <div className="space-y-1">
          {notifications.map((notification) => {
            const meta = NOTIFICATION_ICON[notification.type] ?? { Icon: BellIcon, tone: 'text-white/50 bg-white/[0.06]' };
            const Icon = meta.Icon;
            return (
              <div
                key={notification.id}
                className={`flex items-start gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  !notification.read
                    ? 'border-violet-500/20 bg-violet-500/[0.04] hover:bg-violet-500/[0.06]'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
                onClick={() => {
                  if (!notification.read) {
                    markAsReadMutation.mutate(notification.id);
                  }
                }}
              >
                <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.tone}`}>
                  <Icon className="w-4 h-4" strokeWidth={1.8} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="text-sm font-semibold text-white">{notification.title}</h4>
                    {!notification.read && (
                      <Badge variant="info" size="sm">Nuovo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-white/50 leading-snug">{notification.message}</p>
                  <p className="text-xs text-white/25 mt-1.5">
                    {new Date(notification.created_at).toLocaleString(uiLocaleTag())}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center mb-4">
            <BellIcon className="w-6 h-6 text-white/20" strokeWidth={1.5} />
          </div>
          <p className="text-white/40 text-sm">
            {filter === 'unread' ? t('notifications.emptyUnread') : t('notifications.empty')}
          </p>
        </div>
      )}
    </div>
  );
};
