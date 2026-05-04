export function MigrationScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-gray-900 z-50">
      <div className="text-center space-y-4">
        <div className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
          데이터를 로컬 데이터베이스로 이전 중…
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          잠시 기다려 주세요.
        </div>
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
      </div>
    </div>
  );
}
