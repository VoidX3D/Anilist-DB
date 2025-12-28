"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIME_QUERY = void 0;
exports.ANIME_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    id
    idMal
    title {
      romaji
      english
      native
      userPreferred
    }
    type
    format
    status
    description
    startDate { year month day }
    endDate { year month day }
    season
    seasonYear
    seasonInt
    episodes
    duration
    chapters
    volumes
    countryOfOrigin
    isLicensed
    source
    hashtag
    trailer { id site thumbnail }
    updatedAt
    coverImage { extraLarge large medium color }
    bannerImage
    genres
    synonyms
    averageScore
    meanScore
    popularity
    isLocked
    trending
    favourites
    tags {
      id
      name
      description
      category
      rank
      isGeneralSpoiler
      isMediaSpoiler
      isAdult
      userId
    }
    relations {
      edges {
        id
        relationType
        node {
          id
          title { romaji }
          type
          format
        }
      }
    }
    characters(page: 1, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) {
      nodes {
        id
        name { first middle last full native userPreferred }
        image { large medium }
        description
        gender
        dateOfBirth { year month day }
        age
        bloodType
      }
      edges {
        role
        voiceActors(language: JAPANESE, sort: [RELEVANCE, FAVOURITES_DESC]) {
          id
          name { first middle last full native userPreferred }
          image { large medium }
          languageV2
        }
      }
    }
    staff(page: 1, perPage: 25, sort: [RELEVANCE, FAVOURITES_DESC]) {
      edges {
        role
        node {
          id
          name { first middle last full native userPreferred }
          languageV2
          image { large medium }
          description
          primaryOccupations
        }
      }
    }
    studios {
      nodes {
        id
        name
        isAnimationStudio
      }
    }
    isAdult
    nextAiringEpisode { id airingAt timeUntilAiring episode }
    airingSchedule(notYetAired: true, perPage: 1) {
       nodes {  airingAt episode }
    }
    externalLinks {
      id
      url
      site
      type
      language
    }
    streamingEpisodes {
      title
      thumbnail
      url
      site
    }
    rankings {
      id
      rank
      type
      format
      year
      season
      allTime
      context
    }
    recommendations(page: 1, perPage: 10, sort: [RATING_DESC]) {
      nodes {
         mediaRecommendation {
           id
           title { romaji }
         }
      }
    }
    stats {
      scoreDistribution { score amount }
      statusDistribution { status amount }
    }
  }
}
`;
