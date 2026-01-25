"use client";
import Timeline from "./timeline";
import useStore from "./store/use-store";
import Navbar from "./navbar";
import useTimelineEvents from "./hooks/use-timeline-events";
import { useStateManagerEvents } from "./hooks/use-state-manager-events";
import Scene from "./scene";
import { SceneRef } from "./scene/scene.types";
import StateManager, { DESIGN_LOAD } from "@designcombo/state";
import { useEffect, useRef, useState, useMemo } from "react";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ImperativePanelHandle } from "react-resizable-panels";
import { getCompactFontData, loadFonts } from "./utils/fonts";
import { SECONDARY_FONT, SECONDARY_FONT_URL } from "./constants/constants";
import useDataState from "./store/use-data-state";
import { FONTS } from "./data/fonts";
import { dispatch } from "@designcombo/events";
import { Transcript } from "./menu-item/transcript";
import { design } from "./mock";
import { ChevronLeft, ChevronRight, FileText, Sparkles, X } from "lucide-react";
import { Chat } from "./menu-item/chat";
import useTranscriptStore from "./store/use-transcript-store";
import UploadLanding from "./upload-landing";
import { useIsMobile } from "@/hooks/use-media-query";

const stateManager = new StateManager({
	size: {
		width: 1080,
		height: 1920,
	},
});

// Expose state manager globally for export functionality
if (typeof window !== 'undefined') {
	(window as any).__stateManager = stateManager;
}

const Editor = ({ tempId, id }: { tempId?: string; id?: string }) => {
	const [projectName, setProjectName] = useState<string>("Untitled video");
	const isMobile = useIsMobile();
	// On mobile, panels are closed by default
	const [isTranscriptOpen, setIsTranscriptOpen] = useState(!isMobile);
	const [isChatOpen, setIsChatOpen] = useState(!isMobile);
	const timelinePanelRef = useRef<ImperativePanelHandle>(null);
	const sceneRef = useRef<SceneRef>(null);
	const { timeline, playerRef, trackItemsMap } = useStore();

	// Close panels when switching to mobile view
	useEffect(() => {
		if (isMobile) {
			setIsTranscriptOpen(false);
			setIsChatOpen(false);
		}
	}, [isMobile]);

	// Check if we have any clips (show editor as soon as clips are added, even if transcribing)
	const { clipOrder } = useTranscriptStore();
	const hasAnyClips = clipOrder.length > 0;

	// Show landing only when no clips at all - transcription progress shows in sidebar
	const showLanding = !hasAnyClips;

	useTimelineEvents();
	useStateManagerEvents(stateManager);

	const { setCompactFonts, setFonts } = useDataState();

	useEffect(() => {
		dispatch(DESIGN_LOAD, { payload: design });
	}, []);

	useEffect(() => {
		setCompactFonts(getCompactFontData(FONTS));
		setFonts(FONTS);
	}, []);

	useEffect(() => {
		loadFonts([
			{
				name: SECONDARY_FONT,
				url: SECONDARY_FONT_URL,
			},
		]);
	}, []);

	// Count unique overlay track types (excluding video and caption)
	const overlayTrackCount = useMemo(() => {
		const types = new Set<string>();
		Object.values(trackItemsMap).forEach((item) => {
			if (item.type !== "video" && item.type !== "caption") {
				types.add(item.type);
			}
		});
		return types.size;
	}, [trackItemsMap]);

	// Initial timeline height
	useEffect(() => {
		const screenHeight = window.innerHeight;
		const desiredHeight = 150; // Compact but usable timeline
		const percentage = (desiredHeight / screenHeight) * 100;
		timelinePanelRef.current?.resize(percentage);
	}, []);

	// Auto-expand timeline when overlay tracks are added
	useEffect(() => {
		if (overlayTrackCount === 0) return;

		const screenHeight = window.innerHeight;
		// Base height: header (44px) + main track (60px) + padding (20px)
		// Each overlay track adds 40px
		const baseHeight = 124;
		const overlayHeight = overlayTrackCount * 40;
		const desiredHeight = Math.min(baseHeight + overlayHeight, 300); // Cap at 300px

		const currentSize = timelinePanelRef.current?.getSize() || 0;
		const currentHeight = (currentSize / 100) * screenHeight;

		// Only expand if current height is less than needed
		if (currentHeight < desiredHeight) {
			const percentage = (desiredHeight / screenHeight) * 100;
			timelinePanelRef.current?.resize(percentage);
		}
	}, [overlayTrackCount]);

	const handleTimelineResize = () => {
		const timelineContainer = document.getElementById("timeline-container");
		if (!timelineContainer) return;

		timeline?.resize(
			{
				height: timelineContainer.clientHeight - 90,
				width: timelineContainer.clientWidth - 40,
			},
			{
				force: true,
			},
		);

		// Trigger zoom recalculation when timeline is resized
		setTimeout(() => {
			sceneRef.current?.recalculateZoom();
		}, 100);
	};

	useEffect(() => {
		const onResize = () => handleTimelineResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [timeline]);

	// Progressive disclosure: show simple upload screen when no content
	if (showLanding) {
		return <UploadLanding />;
	}

	return (
		<div className="flex h-screen w-screen flex-col bg-background">
			<Navbar
				projectName={projectName}
				user={null}
				stateManager={stateManager}
				setProjectName={setProjectName}
			/>
			<div className="flex flex-1 relative overflow-hidden">
				{/* Mobile backdrop */}
				{isMobile && (isTranscriptOpen || isChatOpen) && (
					<div
						className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
						onClick={() => {
							setIsTranscriptOpen(false);
							setIsChatOpen(false);
						}}
					/>
				)}

				{/* LEFT PANEL - Transcript */}
				<div
					className={`
						flex flex-none bg-white border-r border-border shadow-sm
						${isMobile
							? 'fixed inset-y-0 left-0 z-50 w-full max-w-[320px] h-full'
							: 'h-[calc(100vh-56px)] w-[300px]'
						}
					`}
					style={{
						transform: isTranscriptOpen ? 'translateX(0)' : 'translateX(-100%)',
						marginRight: !isMobile && isTranscriptOpen ? 0 : !isMobile ? -300 : 0,
						transition: 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1), margin 400ms cubic-bezier(0.4, 0, 0.2, 1)',
					}}
				>
					<Transcript />
				</div>

				{/* Left toggle button - Desktop: slides with panel. Mobile: different behavior */}
				{!isMobile && (
					<button
						onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}
						className="absolute top-3 z-50 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-border shadow-md hover:bg-muted cursor-pointer transition-all"
						style={{
							left: isTranscriptOpen ? 288 : 12,
							transition: 'left 400ms cubic-bezier(0.4, 0, 0.2, 1)',
						}}
					>
						{isTranscriptOpen ? (
							<ChevronLeft className="w-4 h-4 text-gray-600" />
						) : (
							<FileText className="w-4 h-4 text-gray-600" />
						)}
					</button>
				)}

				{/* Mobile: Transcript button - shows on left when closed, slides to right when open */}
				{isMobile && !isChatOpen && (
					<button
						onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}
						className="absolute top-4 z-50 flex items-center justify-center w-11 h-11 rounded-full bg-white border border-border shadow-lg hover:bg-muted cursor-pointer transition-all"
						style={{
							left: isTranscriptOpen ? 'auto' : 12,
							right: isTranscriptOpen ? 12 : 'auto',
							transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
						}}
					>
						{isTranscriptOpen ? (
							<X className="w-5 h-5 text-gray-600" />
						) : (
							<FileText className="w-5 h-5 text-gray-600" />
						)}
					</button>
				)}

				{/* CENTER - Video Preview & Timeline */}
				<ResizablePanelGroup style={{ flex: 1 }} direction="vertical">
					<ResizablePanel className="relative bg-muted" defaultSize={isMobile ? 75 : 82}>
						<div className="flex h-full flex-1">
							<div
								style={{
									width: "100%",
									height: "100%",
									position: "relative",
									flex: 1,
									overflow: "hidden",
								}}
							>
								<Scene ref={sceneRef} stateManager={stateManager} />
							</div>
						</div>
					</ResizablePanel>
					<ResizableHandle className="bg-border hover:bg-primary/20 transition-colors" />
					<ResizablePanel
						className="min-h-[50px]"
						ref={timelinePanelRef}
						defaultSize={isMobile ? 25 : 18}
						onResize={handleTimelineResize}
					>
						{playerRef && <Timeline />}
					</ResizablePanel>
				</ResizablePanelGroup>

				{/* RIGHT PANEL - AI Chat */}
				<div
					className={`
						flex flex-col flex-none bg-white border-l border-border shadow-sm overflow-hidden
						${isMobile
							? 'fixed inset-y-0 right-0 z-50 w-full max-w-[320px] h-full'
							: 'h-[calc(100vh-56px)] w-[400px]'
						}
					`}
					style={{
						transform: isChatOpen ? 'translateX(0)' : 'translateX(100%)',
						marginLeft: !isMobile && isChatOpen ? 0 : !isMobile ? -400 : 0,
						transition: 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1), margin 400ms cubic-bezier(0.4, 0, 0.2, 1)',
					}}
				>
					<Chat />
				</div>

				{/* Right toggle button - Desktop */}
				{!isMobile && (
					<button
						onClick={() => setIsChatOpen(!isChatOpen)}
						className="absolute top-3 z-50 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-border shadow-md hover:bg-muted cursor-pointer transition-all"
						style={{
							right: isChatOpen ? 388 : 12,
							transition: 'right 400ms cubic-bezier(0.4, 0, 0.2, 1)',
						}}
					>
						{isChatOpen ? (
							<ChevronRight className="w-4 h-4 text-gray-600" />
						) : (
							<Sparkles className="w-4 h-4 text-gray-600" />
						)}
					</button>
				)}

				{/* Mobile: AI Chat button - shows on right when closed, slides to left when open */}
				{isMobile && !isTranscriptOpen && (
					<button
						onClick={() => setIsChatOpen(!isChatOpen)}
						className="absolute top-4 z-50 flex items-center justify-center w-11 h-11 rounded-full bg-white border border-border shadow-lg hover:bg-muted cursor-pointer transition-all"
						style={{
							right: isChatOpen ? 'auto' : 12,
							left: isChatOpen ? 12 : 'auto',
							transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
						}}
					>
						{isChatOpen ? (
							<X className="w-5 h-5 text-gray-600" />
						) : (
							<Sparkles className="w-5 h-5 text-gray-600" />
						)}
					</button>
				)}
			</div>
		</div>
	);
};

export default Editor;
