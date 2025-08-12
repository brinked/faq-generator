import React from 'react';
import { motion } from 'framer-motion';

const StepIndicator = ({ steps, currentStep }) => {
  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Main Step Indicator */}
      <div className="relative">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            const isLast = index === steps.length - 1;

            return (
              <div key={step.id} className="flex items-center flex-1">
                {/* Step Circle */}
                <div className="relative flex flex-col items-center">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: index * 0.15, type: "spring", stiffness: 300, damping: 20 }}
                    className="relative"
                  >
                    <div
                      className={`
                        relative w-14 h-14 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 border-4
                        ${isCompleted
                          ? 'bg-gradient-to-br from-green-400 via-green-500 to-emerald-600 text-white shadow-lg border-green-300'
                          : isActive
                            ? 'bg-gradient-to-br from-blue-400 via-blue-500 to-indigo-600 text-white shadow-xl border-blue-300'
                            : 'bg-white text-gray-400 border-gray-200 shadow-sm hover:border-gray-300'
                        }
                      `}
                    >
                      {isCompleted ? (
                        <motion.svg
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
                          className="w-6 h-6"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </motion.svg>
                      ) : (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: index * 0.15 + 0.2 }}
                        >
                          {step.id}
                        </motion.span>
                      )}
                    </div>
                    
                    {/* Enhanced active pulse effect */}
                    {isActive && (
                      <>
                        <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-30"></div>
                        <div className="absolute inset-0 rounded-full bg-blue-300 animate-ping opacity-20" style={{animationDelay: '0.5s'}}></div>
                      </>
                    )}

                    {/* Completion glow effect */}
                    {isCompleted && (
                      <div className="absolute inset-0 rounded-full bg-green-400 opacity-20 blur-sm"></div>
                    )}
                  </motion.div>

                  {/* Step Label */}
                  <div className="mt-6 text-center max-w-36">
                    <motion.h3
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.15 + 0.3, type: "spring", stiffness: 300 }}
                      className={`
                        text-sm font-bold transition-all duration-300
                        ${isActive ? 'text-blue-700 text-base' : isCompleted ? 'text-green-700' : 'text-gray-500'}
                      `}
                    >
                      {step.title}
                    </motion.h3>
                    <motion.p
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.15 + 0.4, type: "spring", stiffness: 300 }}
                      className={`
                        text-xs mt-2 leading-relaxed transition-colors duration-300
                        ${isActive ? 'text-gray-600' : 'text-gray-500'}
                      `}
                    >
                      {step.description}
                    </motion.p>
                  </div>
                </div>

                {/* Enhanced Connector Line */}
                {!isLast && (
                  <div className="flex-1 mx-8 mt-[-4rem] relative">
                    <div className="relative h-2">
                      <div className="h-2 bg-gray-200 w-full rounded-full shadow-inner"></div>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: isCompleted ? '100%' : isActive ? '60%' : '0%'
                        }}
                        transition={{ duration: 0.8, delay: index * 0.15 + 0.5, ease: "easeInOut" }}
                        className={`
                          absolute top-0 left-0 h-2 rounded-full shadow-lg
                          ${isCompleted 
                            ? 'bg-gradient-to-r from-green-400 via-green-500 to-emerald-600' 
                            : 'bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-600'
                          }
                        `}
                      >
                        {/* Animated shimmer effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse rounded-full"></div>
                      </motion.div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Enhanced Progress Summary */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, type: "spring", stiffness: 300 }}
        className="mt-12 relative"
      >
        <div className="glass rounded-2xl p-6 backdrop-blur-xl border border-white/30 shadow-xl relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-indigo-500/10 pointer-events-none"></div>
          
          <div className="relative">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Workflow Progress</h4>
                <p className="text-sm text-gray-600">Track your FAQ generation journey</p>
              </div>
              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    {Math.round(((currentStep - 1) / (steps.length - 1)) * 100)}%
                  </div>
                  <div className="text-xs text-gray-500 font-medium">Complete</div>
                </div>
                <div className="w-16 h-16 relative">
                  <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 64 64">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                      className="text-gray-200"
                    />
                    <motion.circle
                      cx="32"
                      cy="32"
                      r="28"
                      stroke="url(#progressGradient)"
                      strokeWidth="4"
                      fill="none"
                      strokeLinecap="round"
                      initial={{ strokeDasharray: "0 175.929" }}
                      animate={{ 
                        strokeDasharray: `${((currentStep - 1) / (steps.length - 1)) * 175.929} 175.929` 
                      }}
                      transition={{ duration: 1, ease: "easeInOut" }}
                    />
                    <defs>
                      <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#3B82F6" />
                        <stop offset="100%" stopColor="#6366F1" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className={`w-2 h-2 rounded-full ${currentStep === steps.length ? 'bg-green-500' : 'bg-blue-500'} animate-pulse`}></div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
                transition={{ duration: 1, ease: "easeInOut", delay: 0.5 }}
                className="h-full bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 rounded-full shadow-lg relative"
              >
                {/* Animated glow */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-400 opacity-50 blur-sm rounded-full"></div>
                {/* Progress shimmer */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse rounded-full"></div>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default StepIndicator;