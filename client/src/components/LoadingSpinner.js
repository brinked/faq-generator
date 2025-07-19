import React from 'react';
import { motion } from 'framer-motion';

const LoadingSpinner = ({ size = 'medium', text = '', className = '' }) => {
  const sizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-12 h-12'
  };

  const containerClasses = {
    small: 'gap-2',
    medium: 'gap-3',
    large: 'gap-4'
  };

  return (
    <div className={`flex flex-col items-center justify-center ${containerClasses[size]} ${className}`}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className={`${sizeClasses[size]} border-4 border-blue-200 border-t-blue-600 rounded-full`}
      />
      {text && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={`text-gray-600 font-medium ${size === 'small' ? 'text-xs' : size === 'large' ? 'text-lg' : 'text-sm'}`}
        >
          {text}
        </motion.p>
      )}
    </div>
  );
};

export const LoadingDots = ({ text = 'Loading', className = '' }) => {
  return (
    <div className={`flex items-center space-x-1 ${className}`}>
      <span className="text-gray-600">{text}</span>
      <div className="loading-dots flex space-x-1">
        <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
        <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
        <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
      </div>
    </div>
  );
};

export const SkeletonLoader = ({ className = '', lines = 3 }) => {
  return (
    <div className={`animate-pulse ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={`bg-gray-200 rounded h-4 mb-2 ${
            index === lines - 1 ? 'w-3/4' : 'w-full'
          }`}
        />
      ))}
    </div>
  );
};

export const ButtonSpinner = ({ size = 'small' }) => {
  const sizeClass = size === 'small' ? 'w-4 h-4' : 'w-5 h-5';
  
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      className={`${sizeClass} border-2 border-white border-t-transparent rounded-full`}
    />
  );
};

export default LoadingSpinner;