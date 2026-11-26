/**
 * The demo library: ten public-domain titles with bundled covers. Nothing here
 * is written to disk; it exists so screenshots never show a personal library.
 */

import {
  DEMO_HOME_DIR,
  DEMO_LIBRARY_DIR,
  DEMO_ORIGINALS_DIR,
} from "@/demo/constants";
import aliceCover from "@/demo/covers/alice.jpg";
import artOfWarCover from "@/demo/covers/art-of-war.jpg";
import frankensteinCover from "@/demo/covers/frankenstein.jpg";
import jekyllCover from "@/demo/covers/jekyll.jpg";
import prideCover from "@/demo/covers/pride-and-prejudice.jpg";
import sherlockCover from "@/demo/covers/sherlock.jpg";
import timeMachineCover from "@/demo/covers/time-machine.jpg";
import waldenCover from "@/demo/covers/walden.jpg";
import yellowWallpaperCover from "@/demo/covers/yellow-wallpaper.jpg";
import type { Config } from "@/pipeline/config";
import { DEFAULT_FILE_NAME_TEMPLATE } from "@/pipeline/names";
import { type Book, emptyCandidates, type ReadStatus } from "@/pipeline/types";

export const DEMO_CONFIG: Config = {
  homeDir: DEMO_HOME_DIR,
  libraryDir: DEMO_LIBRARY_DIR,
  archiveOriginals: false,
  originalsDir: DEMO_ORIGINALS_DIR,
  fetchMetadata: true,
  cleanConverted: true,
  fetchCovers: true,
  calibreDir: null,
  sortBy: "author",
  fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
};

type DemoInput = {
  id: number;
  file: string;
  title: string;
  titleSort: string;
  authors: string;
  authorSort: string;
  description: string;
  publisher: string;
  published: string;
  tags: string;
  pinned?: boolean;
  pinnedOrder?: number;
  addedAt: string;
  readStatus?: ReadStatus;
  needsReview?: boolean;
  hasCover?: boolean;
};

function demoBook(input: DemoInput): Book {
  return {
    id: input.id,
    bookUuid: null,
    sha256: `demo-${input.id}`,
    epubSha256: null,
    fileSize: null,
    fileMtimeMs: null,
    sourcePath: null,
    archivedPath: null,
    libraryPath: `${DEMO_LIBRARY_DIR}/${input.file}`,
    hasCover: input.hasCover ?? true,
    title: input.title,
    authors: input.authors,
    authorSort: input.authorSort,
    titleSort: input.titleSort,
    isbn: null,
    description: input.description,
    publisher: input.publisher,
    published: input.published,
    language: "en",
    tags: input.tags,
    series: null,
    seriesIndex: null,
    readStatus: input.readStatus ?? "unread",
    personalNotes: null,
    missing: false,
    status: input.needsReview ? "needs_review" : "ok",
    flagReason: input.needsReview ? "metadata_missing" : null,
    candidates: emptyCandidates(),
    notes: null,
    error: null,
    pinned: input.pinned ?? false,
    pinnedOrder: input.pinnedOrder ?? null,
    addedAt: input.addedAt,
    updatedAt: input.addedAt,
  };
}

export const DEMO_BOOKS: Book[] = [
  demoBook({
    id: 1,
    file: "Henry David Thoreau - Walden.epub",
    title: "Walden, and On The Duty Of Civil Disobedience",
    titleSort: "Walden, and On The Duty Of Civil Disobedience",
    authors: "Henry David Thoreau",
    authorSort: "Thoreau, Henry David",
    description:
      "Henry David Thoreau's account of two years spent in a cabin by Walden Pond, and a quiet argument for simplicity, self-reliance, and attention to the natural world.",
    publisher: "Ticknor and Fields",
    published: "1854-08-09",
    tags: "Nature, Solitude, Transcendentalism, American essays",
    pinned: true,
    pinnedOrder: 3,
    addedAt: "2026-11-20T09:15:00.000Z",
  }),
  demoBook({
    id: 2,
    file: "Mary Wollstonecraft Shelley - Frankenstein.epub",
    title: "Frankenstein; or, The modern Prometheus",
    titleSort: "Frankenstein; or, The modern Prometheus",
    authors: "Mary Wollstonecraft Shelley",
    authorSort: "Shelley, Mary Wollstonecraft",
    description:
      "Victor Frankenstein builds a living creature from dead matter, then abandons it in horror. Mary Shelley's Gothic novel follows the creature's loneliness and the consequences of creation without care.",
    publisher: "Lackington, Hughes, Harding, Mavor & Jones",
    published: "1818-01-01",
    tags: "Gothic fiction, Science fiction, Horror, Epistolary fiction",
    pinned: true,
    pinnedOrder: 2,
    addedAt: "2026-11-20T09:16:00.000Z",
  }),
  demoBook({
    id: 3,
    file: "Jane Austen - Pride and Prejudice.epub",
    title: "Pride and Prejudice",
    titleSort: "Pride and Prejudice",
    authors: "Jane Austen",
    authorSort: "Austen, Jane",
    description:
      "Elizabeth Bennet and Mr. Darcy begin as mutual misunderstandings and end as one of English literature's most enduring couples. Jane Austen's novel of manners is also a sharp study of marriage, class, and first impressions.",
    publisher: "T. Egerton",
    published: "1813-01-28",
    tags: "Courtship -- Fiction, Domestic fiction, England -- Fiction, Love stories, Sisters -- Fiction, Social classes -- Fiction, Young women -- Fiction",
    pinned: true,
    pinnedOrder: 1,
    addedAt: "2026-11-20T09:17:00.000Z",
  }),
  demoBook({
    id: 4,
    file: "Lewis Carroll - Alice's Adventures in Wonderland.epub",
    title: "Alice's Adventures in Wonderland",
    titleSort: "Alice's Adventures in Wonderland",
    authors: "Lewis Carroll",
    authorSort: "Carroll, Lewis",
    description:
      "Alice follows a White Rabbit down a hole into a world of talking animals, impossible rules, and a very short-tempered Queen. Lewis Carroll's nonsense classic began as a story told to a real Alice.",
    publisher: "Macmillan",
    published: "1865-11-26",
    tags: "Fantasy fiction, Imaginary places, Children's fiction, Nonsense literature",
    addedAt: "2026-11-21T18:40:00.000Z",
  }),
  demoBook({
    id: 5,
    file: "Arthur Conan Doyle - The Adventures of Sherlock Holmes.epub",
    title: "The Adventures of Sherlock Holmes",
    titleSort: "Adventures of Sherlock Holmes, The",
    authors: "Arthur Conan Doyle",
    authorSort: "Conan Doyle, Arthur",
    description:
      "Twelve of Arthur Conan Doyle's early Sherlock Holmes stories, including “A Scandal in Bohemia” and “The Speckled Band”, narrated by Dr. Watson.",
    publisher: "George Newnes",
    published: "1892-10-14",
    tags: "Detective and mystery stories, Private investigators, England -- Fiction",
    addedAt: "2026-11-22T14:05:00.000Z",
  }),
  demoBook({
    id: 6,
    file: "Charlotte Perkins Gilman - The Yellow Wallpaper.epub",
    title: "The Yellow Wallpaper",
    titleSort: "Yellow Wallpaper, The",
    authors: "Charlotte Perkins Gilman",
    authorSort: "Gilman, Charlotte Perkins",
    description:
      "A new mother is confined to an upstairs room and forbidden to write. Charlotte Perkins Gilman's short story traces her fixation on the wallpaper and the room's hold on her mind.",
    publisher: "The New England Magazine",
    published: "1892-01-01",
    tags: "Feminist fiction, Psychological fiction, Marriage -- Fiction, Women -- Mental health",
    addedAt: "2026-11-23T11:25:00.000Z",
  }),
  demoBook({
    id: 7,
    file: "Franz Kafka - Metamorphosis.epub",
    title: "Metamorphosis",
    titleSort: "Metamorphosis",
    authors: "Franz Kafka",
    authorSort: "Kafka, Franz",
    description:
      "Gregor Samsa wakes one morning to find himself transformed into a giant insect. Franz Kafka's novella follows his family's changing patience and his own shrinking place in the world.",
    publisher: "Kurt Wolff Verlag",
    published: "1915-01-01",
    tags: "Absurdist fiction, Psychological fiction, Family -- Fiction, Insects",
    hasCover: false,
    addedAt: "2026-11-24T08:50:00.000Z",
  }),
  demoBook({
    id: 8,
    file: "Robert Louis Stevenson - The Strange Case of Dr. Jekyll and Mr. Hyde.epub",
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    titleSort: "Strange Case of Dr. Jekyll and Mr. Hyde, The",
    authors: "Robert Louis Stevenson",
    authorSort: "Stevenson, Robert Louis",
    description:
      "A respectable London doctor drinks a potion that lets him become a younger, crueler self. Robert Louis Stevenson's novella is a study of divided identity and the pleasure of giving in.",
    publisher: "Longmans, Green & Co.",
    published: "1886-01-05",
    tags: "Gothic fiction, Horror, Psychological fiction, Multiple personality",
    addedAt: "2026-11-24T19:30:00.000Z",
  }),
  demoBook({
    id: 9,
    file: "Sun Tzu - The Art of War.epub",
    title: "The Art of War",
    titleSort: "Art of War, The",
    authors: "Sun Tzu",
    authorSort: "Sun Tzu",
    description:
      "Sun Tzu's ancient treatise on strategy, deception, terrain, and the cost of prolonged conflict, in Lionel Giles's public-domain translation.",
    publisher: "Luzac & Co.",
    published: "1910-01-01",
    tags: "Military art and science, Strategy, War, Philosophy",
    addedAt: "2026-11-25T16:10:00.000Z",
  }),
  demoBook({
    id: 10,
    file: "H. G. Wells - The Time Machine.epub",
    title: "The Time Machine",
    titleSort: "Time Machine, The",
    authors: "H. G. Wells",
    authorSort: "Wells, H. G.",
    description:
      "A Victorian inventor travels far into the future and finds humanity split into two species. H. G. Wells's short novel helped invent the modern time-travel story.",
    publisher: "William Heinemann",
    published: "1895-01-01",
    tags: "Science fiction, Time travel, Dystopian fiction, England -- Fiction",
    needsReview: true,
    addedAt: "2026-11-26T07:45:00.000Z",
  }),
];

export const DEMO_COVERS: Record<number, string> = {
  1: waldenCover,
  2: frankensteinCover,
  3: prideCover,
  4: aliceCover,
  5: sherlockCover,
  6: yellowWallpaperCover,
  8: jekyllCover,
  9: artOfWarCover,
  10: timeMachineCover,
};

export const DEMO_COVER_SIZES: Record<
  number,
  { width: number; height: number }
> = {
  1: { width: 1068, height: 1562 },
  2: { width: 1125, height: 1724 },
  3: { width: 1482, height: 2304 },
  4: { width: 800, height: 1104 },
  5: { width: 668, height: 1000 },
  6: { width: 688, height: 1000 },
  8: { width: 500, height: 862 },
  9: { width: 1024, height: 1536 },
  10: { width: 650, height: 1000 },
};
