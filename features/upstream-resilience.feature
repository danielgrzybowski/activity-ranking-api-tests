@resilience @rankings
Feature: Behaving well when Open-Meteo does not

  The API is a thin layer over somebody else's service. When that service is
  slow, rate-limited or broken, the user needs a distinguishable answer -
  something the front end can turn into "try again in a minute" rather than
  a blank screen. These scenarios also pin down what we ask Open-Meteo for,
  because a wrong query is an outage nobody notices.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities
    And every day of the forecast for "Paris" is a "PERFECT_SUMMER_DAY"

  Scenario: The forecast request asks for exactly what the ranking needs
    When I request rankings for location id "2988507"
    Then Open-Meteo's forecast service was called once
    And the forecast request used the coordinates of "Paris"
    And the forecast request asked for 7 days
    And the forecast request asked for the daily variables:
      | temperature_2m_max |
      | temperature_2m_min |
      | precipitation_sum  |
      | snowfall_sum       |
      | wind_speed_10m_max |

  Scenario: One ranking costs at most one geocoding call and one forecast call
    When I request rankings for location id "2988507"
    Then Open-Meteo's forecast service was called once
    And Open-Meteo's geocoding service was called at most once

  Scenario: A broken forecast service is reported as an upstream failure
    Given Open-Meteo's forecast service is returning server errors
    When I request rankings for location id "2988507"
    Then the response status is 502
    And the error code is "UPSTREAM_UNAVAILABLE"
    And the response matches the error contract

  Scenario: A broken geocoding service is reported as an upstream failure
    Given Open-Meteo's geocoding service is returning server errors
    When I request rankings for the city "Paris"
    Then the response status is 502
    And the error code is "UPSTREAM_UNAVAILABLE"

  Scenario: A hanging forecast service is reported as a timeout
    Given Open-Meteo's forecast service never responds
    When I request rankings for location id "2988507"
    Then the response status is 504
    And the error code is "UPSTREAM_TIMEOUT"

  # A hung upstream must not hold a user's connection open indefinitely.
  Scenario: A hanging forecast service still answers the user quickly
    Given Open-Meteo's forecast service never responds
    When I request rankings for location id "2988507"
    Then the response arrived within the "rankings" latency budget

  Scenario: Being rate-limited is distinguishable from being broken
    Given Open-Meteo's forecast service is rate limiting
    When I request rankings for location id "2988507"
    Then the response status is 503
    And the error code is "UPSTREAM_RATE_LIMITED"
    And the "retry-after" header is present

  Scenario: A truncated upstream payload does not leak out as a 500
    Given Open-Meteo's forecast service is returning malformed data
    When I request rankings for location id "2988507"
    Then the response status is 502
    And the error code is "UPSTREAM_UNAVAILABLE"
    And the response matches the error contract

  # No point spending forecast quota on a place we failed to identify.
  Scenario: A geocoding failure stops the forecast call from being made
    Given Open-Meteo's geocoding service is returning server errors
    When I request rankings for the city "Paris"
    Then Open-Meteo's forecast service was not called

  Scenario: A short forecast is served as far as it goes, not padded
    Given Open-Meteo only has 4 days of forecast
    And every day of the forecast for "Paris" is a "PERFECT_SUMMER_DAY"
    When I request rankings for location id "2988507"
    Then the response status is 200
    And the response matches the rankings contract
    And the ranking covers 4 consecutive days starting from the first forecast day
