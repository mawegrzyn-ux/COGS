import MediaLibrary from '../components/MediaLibrary'

export default function MediaLibraryPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <MediaLibrary
        open={true}
        onClose={() => {}}
        mode="page"
      />
    </div>
  )
}
