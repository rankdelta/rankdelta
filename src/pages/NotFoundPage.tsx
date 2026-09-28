/**
 * 404 Not Found Page
 *
 * Displayed when users navigate to a non-existent route. Matches the dark Rankdelta app shell.
 */

import { motion } from 'framer-motion';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';

export const NotFoundPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const home = getDefaultAuthenticatedHomePath();

  return (
    <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center px-4">
      <motion.div
        className="text-center max-w-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Animated 404 */}
        <motion.div
          className="text-[150px] font-bold leading-none bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent mb-4"
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          404
        </motion.div>

        <h1 className="text-3xl font-bold text-white mb-4">{t('notFound.title')}</h1>

        <p className="text-white/50 mb-8 text-lg leading-relaxed">{t('notFound.body')}</p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate({ to: home as any })}
            className="px-6 py-3 bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-all"
          >
            {t('notFound.goHome')}
          </button>
          <button
            onClick={() => window.history.back()}
            className="px-6 py-3 bg-white/[0.06] text-white/80 font-semibold rounded-full border border-white/[0.1] hover:bg-white/[0.1] transition-all"
          >
            {t('notFound.goBack')}
          </button>
        </div>

        {/* Decorative elements */}
        <div className="mt-16 flex justify-center gap-4">
          <motion.div
            className="w-3 h-3 rounded-full bg-violet-500"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
          />
          <motion.div
            className="w-3 h-3 rounded-full bg-fuchsia-500"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
          />
          <motion.div
            className="w-3 h-3 rounded-full bg-violet-500"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
          />
        </div>
      </motion.div>
    </div>
  );
};

export default NotFoundPage;
