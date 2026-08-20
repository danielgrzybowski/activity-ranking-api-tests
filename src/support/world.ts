import { setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber';
import type { ApiResponse } from './api-client';
import { parseWith } from './assertions';
import {
  ErrorResponseSchema,
  LocationsResponseSchema,
  RankingsResponseSchema,
  type ErrorResponse,
  type LocationsResponse,
  type RankingsResponse,
} from './schemas';

export class ActivityRankingWorld extends World {
  /** The most recent response from the API under test. */
  response: ApiResponse | undefined;

  /** Responses from a repeat call, for determinism scenarios. */
  repeatResponse: ApiResponse | undefined;

  constructor(options: IWorldOptions) {
    super(options);
  }

  get lastResponse(): ApiResponse {
    if (!this.response) {
      throw new Error('No request has been made yet in this scenario.');
    }
    return this.response;
  }

  rankings(): RankingsResponse {
    return parseWith(RankingsResponseSchema, this.lastResponse.body, 'The rankings response');
  }

  locations(): LocationsResponse {
    return parseWith(LocationsResponseSchema, this.lastResponse.body, 'The locations response');
  }

  errorBody(): ErrorResponse {
    return parseWith(ErrorResponseSchema, this.lastResponse.body, 'The error response');
  }
}

setWorldConstructor(ActivityRankingWorld);
